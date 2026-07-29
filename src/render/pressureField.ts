/**
 * Turns solved node heads into gauge pressures and maps them onto tiles for
 * coloring. Pure functions — no Canvas/DOM — so they're unit-testable and
 * reusable by both the renderer and any future report/legend.
 */

import { headToPressure } from '../domain/units';
import { waterProperties } from '../domain/fluid';
import { CompileResult } from '../grid/compile';
import { GridModel } from '../grid/types';

export interface PressureField {
  /** node id -> gauge pressure [Pa]. */
  nodePressure: Map<string, number>;
  min: number;
  max: number;
}

const EMPTY_FIELD: PressureField = { nodePressure: new Map(), min: 0, max: 0 };

export function computePressureField(
  grid: GridModel,
  compiled: CompileResult,
  heads: Map<string, number> | null,
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
  return { nodePressure, min, max };
}

/** Normalize a pressure [Pa] to 0..1 against the field's current range. */
export function normalizedPressure(field: PressureField, p: number): number {
  const span = field.max - field.min;
  if (span < 1e-6) return 0.5;
  return (p - field.min) / span;
}

export interface TilePressure {
  /** Gauge pressure [Pa] at (or interpolated across) this tile. */
  pa: number;
  /** Normalized 0..1 against the field's current range, for the colormap. */
  t: number;
}

/** Pressure to show for a tile: its own node, the average of its two nodes
 * (valve/pump), or interpolated along its run's position (pass-through). */
export function tilePressure(tileId: string, compiled: CompileResult, field: PressureField): TilePressure | null {
  const nodeIds = compiled.tileNodes.get(tileId);
  if (nodeIds && nodeIds.length === 1) {
    const pa = field.nodePressure.get(nodeIds[0]);
    return pa === undefined ? null : { pa, t: normalizedPressure(field, pa) };
  }
  if (nodeIds && nodeIds.length === 2) {
    const a = field.nodePressure.get(nodeIds[0]);
    const b = field.nodePressure.get(nodeIds[1]);
    if (a === undefined || b === undefined) return null;
    const pa = (a + b) / 2;
    return { pa, t: normalizedPressure(field, pa) };
  }

  const linkId = compiled.tileLink.get(tileId);
  if (!linkId) return null;
  const link = compiled.network.links.find((l) => l.id === linkId);
  if (!link) return null;
  const pFrom = field.nodePressure.get(link.from);
  const pTo = field.nodePressure.get(link.to);
  if (pFrom === undefined || pTo === undefined) return null;

  const order = compiled.linkRunTiles.get(linkId);
  const frac = order && order.length > 0 ? (order.indexOf(tileId) + 0.5) / order.length : 0.5;
  const pa = pFrom + (pTo - pFrom) * frac;
  return { pa, t: normalizedPressure(field, pa) };
}
