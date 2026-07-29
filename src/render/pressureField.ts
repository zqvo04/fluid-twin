/**
 * Turns a solved network into a field the renderer can color tiles by.
 *
 * Two related but distinct quantities live here:
 *  - static pressure  ps = rho*g*(H - z) - 0.5*rho*V^2   — the physically
 *    correct quantity for e.g. the cavitation check, since it's what the
 *    fluid itself locally "feels" and can be compared against vapor
 *    pressure. It decreases monotonically along a pipe in the flow
 *    direction, exactly like the real thing.
 *  - wall-load (a rendering heuristic, not physics) ps + C_imp*0.5*rho*V^2
 *    — an engineering indicator of impingement/stagnation loading at bends
 *    and branch legs (a curved duct's outer wall genuinely sees a local
 *    pressure rise from flow curvature, dp/dr = rho V^2/r, even while bulk
 *    static pressure falls through the fitting). This is what tiles are
 *    colored by, so a corner or a throttled valve reads hot even though the
 *    bulk pressure trend through it is downward. See IMPACT_COEFFICIENT.
 *
 * Node pressure (at reservoirs/junctions) has no single well-defined local
 * velocity — several links can meet there — so nodes keep the simpler
 * "hydraulic grade line" pressure rho*g*(H - z), the same convention EPANET
 * and friends use. Only pipe/valve tiles, which belong to exactly one link
 * with one solved velocity, get the static/wall-load treatment.
 */

import { headToPressure, G } from '../domain/units';
import { FluidState, waterProperties } from '../domain/fluid';
import { pipeGeometry } from '../domain/catalog/pipes';
import { fittingK, IMPACT_COEFFICIENT } from '../domain/catalog/fittings';
import { reynolds, churchillFriction } from '../physics/friction';
import { CompileResult } from '../grid/compile';
import { Direction, GridModel } from '../grid/types';
import { tilePorts } from '../grid/ports';

/** Per-link flow/velocity, the same shape steadySolver.ts's SteadyResult.links uses. */
export interface LinkFlowVelocity {
  flow: number;
  velocity: number;
}

export interface PressureField {
  /** node id -> hydraulic-grade-line gauge pressure [Pa] (rho*g*(H-z)). */
  nodePressure: Map<string, number>;
  min: number;
  max: number;
  /** link id -> solved flow/velocity, when available (null before a solve). */
  links: Map<string, LinkFlowVelocity>;
  fluid: FluidState;
}

const EMPTY_FIELD: PressureField = {
  nodePressure: new Map(),
  min: 0,
  max: 0,
  links: new Map(),
  fluid: waterProperties(20),
};

export function computePressureField(
  grid: GridModel,
  compiled: CompileResult,
  heads: Map<string, number> | null,
  links?: Map<string, LinkFlowVelocity> | null,
): PressureField {
  if (!heads || heads.size === 0) return EMPTY_FIELD;
  const fluid = waterProperties(grid.temperatureC);
  const nodePressure = new Map<string, number>();
  for (const node of compiled.network.nodes) {
    const h = heads.get(node.id);
    if (h === undefined) continue;
    nodePressure.set(node.id, headToPressure(h - node.position.y, fluid.rho));
  }
  let min = Infinity;
  let max = -Infinity;
  for (const p of nodePressure.values()) {
    if (p < min) min = p;
    if (p > max) max = p;
  }
  if (!Number.isFinite(min)) return EMPTY_FIELD;
  return { nodePressure, min, max, links: links ?? new Map(), fluid };
}

/** Normalize a pressure [Pa] to 0..1 against the field's current range. */
export function normalizedPressure(field: PressureField, p: number): number {
  const span = field.max - field.min;
  if (span < 1e-6) return 0.5;
  return (p - field.min) / span;
}

export interface TilePressure {
  /** Static gauge pressure [Pa] — the physically-real quantity, used for
   * checks like the cavitation warning (pa < 0). For a valve this is the
   * lower (more cavitation-prone) of its two sides. */
  pa: number;
  /** Normalized 0..1 of the wall-load-adjusted pressure, for the colormap. */
  t: number;
  /** Present only for a 2-port tile (valve) whose two sides should render
   * as distinct colors instead of one averaged tone. */
  perPort?: Partial<Record<Direction, number>>;
}

const velocityHead = (rho: number, v: number): number => 0.5 * rho * v * v;

/** Pressure to show for a tile: its own node, its own link's two sides
 * (valve/pump), or its position within a pass-through run (pipe). */
export function tilePressure(tileId: string, grid: GridModel, compiled: CompileResult, field: PressureField): TilePressure | null {
  const nodeIds = compiled.tileNodes.get(tileId);

  if (nodeIds && nodeIds.length === 1) {
    const pa = field.nodePressure.get(nodeIds[0]);
    return pa === undefined ? null : { pa, t: normalizedPressure(field, pa) };
  }

  if (nodeIds && nodeIds.length === 2) {
    return twoPortTilePressure(tileId, nodeIds, grid, compiled, field);
  }

  return runTilePressure(tileId, grid, compiled, field);
}

/** Valve/pump tile: two nodes joined by one link with one solved velocity. */
function twoPortTilePressure(
  tileId: string,
  nodeIds: string[],
  grid: GridModel,
  compiled: CompileResult,
  field: PressureField,
): TilePressure | null {
  const a = field.nodePressure.get(nodeIds[0]);
  const b = field.nodePressure.get(nodeIds[1]);
  if (a === undefined || b === undefined) return null;

  const linkId = compiled.tileLink.get(tileId);
  const lf = linkId ? field.links.get(linkId) : undefined;
  const tile = grid.tiles.find((t) => t.id === tileId);

  if (lf && Number.isFinite(lf.velocity) && tile && tile.kind === 'valve') {
    // A valve's two sides render independently (not averaged) so a
    // significantly throttled valve shows its upstream/downstream split
    // instead of cancelling out to a neutral middle color.
    const vHead = velocityHead(field.fluid.rho, lf.velocity);
    const staticA = a - vHead;
    const staticB = b - vHead;
    const ports = tilePorts(tile);
    const perPort: Partial<Record<Direction, number>> =
      ports.length === 2
        ? { [ports[0]]: normalizedPressure(field, staticA), [ports[1]]: normalizedPressure(field, staticB) }
        : {};
    return { pa: Math.min(staticA, staticB), t: normalizedPressure(field, (staticA + staticB) / 2), perPort };
  }

  const pa = (a + b) / 2;
  return { pa, t: normalizedPressure(field, pa) };
}

/** Pipe tile: part of a (possibly multi-tile) pass-through run. */
function runTilePressure(tileId: string, grid: GridModel, compiled: CompileResult, field: PressureField): TilePressure | null {
  const linkId = compiled.tileLink.get(tileId);
  if (!linkId) return null;
  const link = compiled.network.links.find((l) => l.id === linkId);
  if (!link || link.kind !== 'pipe') return null;
  const pFrom = field.nodePressure.get(link.from);
  const pTo = field.nodePressure.get(link.to);
  if (pFrom === undefined || pTo === undefined) return null;

  const order = compiled.linkRunTiles.get(linkId);
  if (!order || order.length === 0) {
    const pa = (pFrom + pTo) / 2;
    return { pa, t: normalizedPressure(field, pa) };
  }
  const idx = order.indexOf(tileId);
  if (idx === -1) return null;

  const lf = field.links.get(linkId);
  if (!lf || !Number.isFinite(lf.velocity) || lf.velocity === 0) {
    // No solved (nonzero) velocity yet — plain uniform interpolation.
    const frac = (idx + 0.5) / order.length;
    const pa = pFrom + (pTo - pFrom) * frac;
    return { pa, t: normalizedPressure(field, pa) };
  }

  const geo = pipeGeometry(link.nps, link.schedule);
  const flowEquiv = lf.velocity * geo.area;
  const re = reynolds(flowEquiv, geo.id, field.fluid.rho, field.fluid.mu);
  const f = churchillFriction(re, 0.045e-3 / geo.id);
  const perCell = (f * grid.cellSize) / (geo.id * 2 * G * geo.area * geo.area);
  const elbowBonus = fittingK('elbow90', link.nps) / (2 * G * geo.area * geo.area);

  const tiles = order.map((id) => grid.tiles.find((t) => t.id === id));
  // Every slot carries the same friction share (same D/f/Q throughout one
  // link); an elbow's slot additionally carries its fitting-K share, so its
  // position soaks up a proportionally larger piece of the total drop —
  // the same accounting resistance.ts uses to solve the network, applied
  // here to place each tile correctly rather than spacing them evenly.
  const weights = tiles.map((t) => perCell + (t?.kind === 'elbow' ? elbowBonus : 0));
  const totalWeight = weights.reduce((s, w) => s + w, 0);

  // Position at the tile's *entry* (cumulative weight of tiles strictly
  // before it), not its midpoint: a fitting's own extra weight describes
  // the loss it imposes on what comes after it, not a discount against its
  // own displayed reading — using the midpoint would partially "pre-pay"
  // the elbow's own bonus into its own value, burying the wall-load bump
  // under a drop the elbow itself hasn't happened yet at that point.
  let before = 0;
  for (let i = 0; i < idx; i++) before += weights[i];
  const frac = totalWeight > 1e-12 ? before / totalWeight : idx / order.length;

  const pTotalHere = pFrom + (pTo - pFrom) * frac;
  const vHead = velocityHead(field.fluid.rho, lf.velocity);
  const pStatic = pTotalHere - vHead;

  const impact = tiles[idx]?.kind === 'elbow' ? IMPACT_COEFFICIENT.elbow90 : 0;
  const pWall = pStatic + impact * vHead;

  return { pa: pStatic, t: normalizedPressure(field, pWall) };
}
