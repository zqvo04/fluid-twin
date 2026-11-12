/**
 * "왜?" panel data (PLAN-V2 §1.3): the curves behind an operating point.
 *
 *  - Pump: its H–Q curve at the current speed, and the system curve. The
 *    system curve is traced by re-solving the network with this pump at other
 *    speeds — every such duty point lies on the system curve, since the
 *    system does not depend on the pump — so it is exact for any network
 *    (branches, other pumps, static lift), not a fitted k·Q².
 *  - Valve: flow vs opening, by re-solving at each opening.
 * The marked operating point is the element's readout (§1.2).
 */

import { compile } from '../grid/compile';
import { updateTile } from '../grid/ops';
import { GridModel } from '../grid/types';
import { pumpHead } from '../domain/catalog/pumps';
import { m3sToM3h } from '../domain/units';
import { solveSteadyState } from '../physics/steadySolver';
import { SolvedState, elementReadout } from '../readouts';

export interface Point {
  x: number;
  y: number;
}

/** Duty point of the pump tile `id` [m³/h, m], or null if the solve fails. */
function dutyAt(grid: GridModel, id: string): Point | null {
  const c = compile(grid);
  const r = solveSteadyState(c.network);
  const lr = r.links.get(c.tileLink.get(id) ?? '');
  return r.converged && lr ? { x: m3sToM3h(lr.flow), y: -lr.headLoss } : null;
}

export interface PumpChart {
  /** Pump curve at the current speed: Q [m³/h] → H [m]. */
  pump: Point[];
  /** System curve: Q [m³/h] → required head [m]. */
  system: Point[];
  /** Current duty point (readouts: flowM3h, headM). */
  duty: Point;
}

export function pumpChart(grid: GridModel, result: SolvedState, id: string): PumpChart | null {
  const tile = grid.tiles.find((t) => t.id === id);
  if (tile?.kind !== 'pump' || !tile.running) return null;
  const r = elementReadout(grid, compile(grid), result, id);
  if (r?.flowM3h === undefined || r.headM === undefined) return null;

  const n = tile.speedRatio;
  // Pump curve out to where it meets zero head.
  const qMax = (tile.spec.bepFlow * 2 * n);
  const pump: Point[] = [];
  for (let i = 0; i <= 24; i++) {
    const q = (qMax * i) / 24;
    const h = pumpHead(tile.spec, q, n);
    if (h < 0) break;
    pump.push({ x: m3sToM3h(q), y: h });
  }
  const system = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3]
    .map((k) => dutyAt(updateTile(grid, id, { speedRatio: n * k }), id))
    .filter((p): p is Point => p !== null && p.x > 0)
    .sort((a, b) => a.x - b.x);
  return { pump, system, duty: { x: r.flowM3h, y: r.headM } };
}

export interface ValveChart {
  /** Opening [%] → flow through the valve [m³/h]. */
  curve: Point[];
  /** Current point (readouts: openingPct, flowM3h). */
  now: Point;
}

export function valveChart(grid: GridModel, result: SolvedState, id: string): ValveChart | null {
  const tile = grid.tiles.find((t) => t.id === id);
  if (tile?.kind !== 'valve') return null;
  const r = elementReadout(grid, compile(grid), result, id);
  if (r?.flowM3h === undefined || r.openingPct === undefined) return null;
  const curve: Point[] = [];
  for (let i = 0; i <= 10; i++) {
    const g = updateTile(grid, id, { opening: i / 10 });
    const c = compile(g);
    const s = solveSteadyState(c.network);
    const lr = s.links.get(c.tileLink.get(id) ?? '');
    if (s.converged && lr) curve.push({ x: i * 10, y: Math.abs(m3sToM3h(lr.flow)) });
  }
  return { curve, now: { x: r.openingPct, y: r.flowM3h } };
}
