/**
 * Render lists: what a mode draws, as plain data — one item per element
 * (tile id or instrument tag) with the labels and numbers it shows. Both
 * renderers build one and only paint it, so the two modes can be checked
 * against each other and against readouts.ts without a canvas (§1.2).
 */

import { Cell, InstrumentType, TileKind } from '../grid/types';
import { Readout } from '../readouts';

export type ValueKey =
  | 'flowM3h'
  | 'pressureBarG'
  | 'inletPressureBarG'
  | 'velocityMs'
  | 'dpBar'
  | 'headM'
  | 'openingPct'
  | 'speedPct'
  | 'levelM'
  | 'value';

export interface RenderItem {
  id: string;
  kind: TileKind | InstrumentType;
  /** Cell it is drawn at (an instrument: its target's cell). */
  cell: Cell;
  labels: string[];
  /** Numbers shown, each copied unchanged from the element's Readout. */
  values: Partial<Record<ValueKey, number>>;
}

/** Copy the listed readout fields that are set. */
export function pickValues(r: Readout, keys: ValueKey[]): RenderItem['values'] {
  const out: RenderItem['values'] = {};
  for (const k of keys) {
    const v = r[k];
    if (typeof v === 'number') out[k] = v;
  }
  return out;
}

export const UNIT: Record<ValueKey, string> = {
  flowM3h: 'm³/h',
  pressureBarG: 'bar g',
  inletPressureBarG: 'bar g',
  velocityMs: 'm/s',
  dpBar: 'bar',
  headM: 'm',
  openingPct: '%',
  speedPct: '%',
  levelM: 'm',
  value: '',
};

/** Display formatting only — never arithmetic on the value. */
export function fmt(v: number, unit: string): string {
  const digits = unit === 'm³/h' || unit === '%' ? 1 : unit.startsWith('bar') ? 3 : 2;
  return `${v.toFixed(digits)} ${unit}`;
}
