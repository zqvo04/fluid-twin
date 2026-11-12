/**
 * Single source of every number shown on screen (PLAN-V2 §1.2): PFD and map
 * renderers call these selectors and only draw. Values come out in display
 * units (m³/h, bar g, m/s, %, m); renderers do no further arithmetic.
 *
 * Pressure convention: gauge pressure of the hydraulic grade line,
 * p = ρg(H − z) — the same node-pressure convention as pressureField.ts.
 */

import { CompileResult } from './grid/compile';
import { reservoirThroughput } from './analysis/networkVulnerability';
import { GridModel, Instrument, InstrumentType, Tile, TileKind, cellElevation } from './grid/types';
import { G, m3sToM3h, paToBar } from './domain/units';

/**
 * The solved state readouts need — a SolvedState, a scenario frame's
 * result, or the UI's worker result plus its fluid all fit.
 */
export interface SolvedState {
  heads: Map<string, number>;
  links: Map<string, { flow: number; velocity: number; headLoss: number }>;
  fluid: { rho: number };
}

export interface Readout {
  /** Tile id, or the instrument tag. */
  id: string;
  kind: TileKind | InstrumentType;
  tag?: string;
  /**
   * Flow [m³/h]. Pump: signed, + = forward (suction → discharge). Basin /
   * source / sink: signed net outflow. Everything else: magnitude — its
   * direction is the flow arrow's job, and inlet/outlet below follow it.
   */
  flowM3h?: number;
  /** Bulk velocity magnitude [m/s]; none for a pump (no single bore). */
  velocityMs?: number;
  /**
   * Gauge pressure at the element [bar g]. Two-node elements: the outlet —
   * downstream by actual flow, a pump's discharge, a spray's header.
   */
  pressureBarG?: number;
  /** Two-node elements: the inlet (upstream; pump suction) [bar g]. */
  inletPressureBarG?: number;
  /** Pressure drop inlet → outlet [bar]; negative across a running pump (rise). */
  dpBar?: number;
  /** Pump head rise [m]. */
  headM?: number;
  openingPct?: number;
  speedPct?: number;
  running?: boolean;
  /** Basin water level [m]. */
  levelM?: number;
  /** Instruments: the indicated value, in `unit`. */
  value?: number;
  unit?: string;
}

export interface StreamRow {
  /** Stream number ◇n: pipe runs in compile order, from 1. */
  stream: number;
  linkId: string;
  /** Tile ids owning the run's upstream / downstream ends, by actual flow. */
  fromId: string;
  toId: string;
  /** Flow magnitude [m³/h] (from → to). */
  flowM3h: number;
  velocityMs: number;
  /** Gauge pressure at the upstream end [bar g]. */
  pressureBarG: number;
}

/** Tile owning a compiled node (its hub), or the node id itself. */
export function ownerOfNode(compiled: CompileResult, nodeId: string): string {
  for (const [tileId, nodeIds] of compiled.tileNodes) if (nodeIds.includes(nodeId)) return tileId;
  return nodeId;
}

function nodeBarG(compiled: CompileResult, result: SolvedState, nodeId: string): number | undefined {
  const head = result.heads.get(nodeId);
  const node = compiled.network.nodes.find((n) => n.id === nodeId);
  if (head === undefined || !node) return undefined;
  return paToBar(result.fluid.rho * G * (head - node.position.y));
}

/** Net flow leaving a node through its links [m³/s]. */
function nodeOutflow(compiled: CompileResult, result: SolvedState, nodeId: string): number {
  let q = 0;
  for (const l of compiled.network.links) {
    const f = result.links.get(l.id)?.flow ?? 0;
    if (l.from === nodeId) q += f;
    if (l.to === nodeId) q -= f;
  }
  return q;
}

function tileReadout(model: GridModel, compiled: CompileResult, result: SolvedState | null, tile: Tile): Readout {
  const r: Readout = { id: tile.id, kind: tile.kind };
  if ('tag' in tile) r.tag = tile.tag;
  if (tile.kind === 'valve') r.openingPct = tile.opening * 100;
  if (tile.kind === 'pump') {
    r.running = tile.running;
    r.speedPct = tile.running ? tile.speedRatio * 100 : 0;
  }
  if (tile.kind === 'basin') r.levelM = tile.level;
  if (!result) return r;

  const nodes = compiled.tileNodes.get(tile.id);
  const linkId = compiled.tileLink.get(tile.id);
  const link = linkId ? result.links.get(linkId) : undefined;

  if (nodes?.length === 2) {
    // Two-node element: valve, pump, strainer, hx, spray. A pump's ports are
    // physical (suction, discharge); the passive ones are symmetric, so orient
    // them by the flow actually going through.
    const reversed = tile.kind !== 'pump' && tile.kind !== 'spray' && (link?.flow ?? 0) < 0;
    const [inNode, outNode] = reversed ? [nodes[1], nodes[0]] : nodes;
    r.inletPressureBarG = nodeBarG(compiled, result, inNode);
    r.pressureBarG = nodeBarG(compiled, result, outNode);
    if (tile.kind === 'spray') r.pressureBarG = r.inletPressureBarG; // header pressure, not the jet's atmosphere
    else if (r.inletPressureBarG !== undefined && r.pressureBarG !== undefined) r.dpBar = r.inletPressureBarG - r.pressureBarG;
  } else if (nodes?.length === 1) {
    r.pressureBarG = nodeBarG(compiled, result, nodes[0]);
    if (tile.kind === 'basin' || tile.kind === 'source' || tile.kind === 'sink') {
      r.flowM3h = m3sToM3h(nodeOutflow(compiled, result, nodes[0]));
    }
  } else if (link && linkId) {
    // Pass-through pipe tile: head varies linearly along the run (friction),
    // read at the tile's position in it, against the tile's own elevation.
    const pipe = compiled.network.links.find((l) => l.id === linkId)!;
    const run = compiled.linkRunTiles.get(linkId) ?? [];
    const hFrom = result.heads.get(pipe.from);
    const hTo = result.heads.get(pipe.to);
    if (hFrom !== undefined && hTo !== undefined) {
      const frac = (run.indexOf(tile.id) + 0.5) / Math.max(run.length, 1);
      const z = cellElevation(model, tile.cell);
      r.pressureBarG = paToBar(result.fluid.rho * G * (hFrom + (hTo - hFrom) * frac - z));
    }
  }

  if (link) {
    r.flowM3h = m3sToM3h(tile.kind === 'pump' ? link.flow : Math.abs(link.flow));
    if (Number.isFinite(link.velocity)) r.velocityMs = Math.abs(link.velocity);
    if (tile.kind === 'pump') r.headM = -link.headLoss;
  }
  return r;
}

const INSTRUMENT_FIELD: Record<InstrumentType, { field: keyof Readout; unit: string }> = {
  FI: { field: 'flowM3h', unit: 'm³/h' },
  FIC: { field: 'flowM3h', unit: 'm³/h' },
  PI: { field: 'pressureBarG', unit: 'bar g' },
  LI: { field: 'levelM', unit: 'm' },
};

function instrumentReadout(model: GridModel, compiled: CompileResult, result: SolvedState | null, inst: Instrument): Readout {
  const target = model.tiles.find((t) => t.id === inst.targetId);
  const { field, unit } = INSTRUMENT_FIELD[inst.type];
  const value = target ? tileReadout(model, compiled, result, target)[field] : undefined;
  return { id: inst.tag, kind: inst.type, tag: inst.tag, unit, value: typeof value === 'number' ? value : undefined };
}

/**
 * Readout for one element: a tile id or an instrument tag. With no result
 * (unsolved) only the static settings (opening, speed, level, tag) are set.
 */
export function elementReadout(
  model: GridModel,
  compiled: CompileResult,
  result: SolvedState | null,
  id: string,
): Readout | null {
  const tile = model.tiles.find((t) => t.id === id);
  if (tile) return tileReadout(model, compiled, result, tile);
  const inst = model.instruments.find((i) => i.tag === id);
  return inst ? instrumentReadout(model, compiled, result, inst) : null;
}

/** PFD stream table: one row per pipe run. */
export function streamTable(compiled: CompileResult, result: SolvedState): StreamRow[] {
  const rows: StreamRow[] = [];
  for (const link of compiled.network.links) {
    if (!compiled.linkRunTiles.has(link.id)) continue; // equipment links are not streams
    const lr = result.links.get(link.id);
    if (!lr) continue;
    const [upstream, downstream] = lr.flow >= 0 ? [link.from, link.to] : [link.to, link.from];
    rows.push({
      stream: rows.length + 1,
      linkId: link.id,
      fromId: ownerOfNode(compiled, upstream),
      toId: ownerOfNode(compiled, downstream),
      flowM3h: m3sToM3h(Math.abs(lr.flow)),
      velocityMs: Math.abs(lr.velocity),
      pressureBarG: nodeBarG(compiled, result, upstream) ?? NaN,
    });
  }
  return rows;
}

/**
 * System readout: net flow the network actually delivers between its
 * reservoirs (source → sink, basin → spray return …) [m³/h]. The status bar's
 * "송출"; flow merely circulating in a loop does not count.
 */
export function throughputM3h(compiled: CompileResult, result: SolvedState): number {
  return m3sToM3h(reservoirThroughput(compiled.network, result));
}
