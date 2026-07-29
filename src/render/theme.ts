/**
 * Canvas draw colors for the grid. Mirrors the soft/playful palette in
 * tokens.css but as plain JS constants — reading CSS custom properties back
 * out for every Canvas fillStyle would add a layer of indirection for no
 * benefit, since the grid canvas doesn't currently re-theme at runtime.
 */

export const CANVAS_BG = '#eaf7f6';
export const GRID_LINE = '#cfe8e6';
export const GRID_LINE_STRONG = '#b9dcda';

export const PIPE_FILL = '#e4527a';
export const PIPE_OUTLINE = '#c43862';
export const PIPE_HIGHLIGHT = '#f4a8bc';

export const VALVE_FILL = '#ffc94d';
export const VALVE_OUTLINE = '#dd9f00';

export const PUMP_FILL = '#7c6fe0';
export const PUMP_OUTLINE = '#5b4fc4';

export const SOURCE_FILL = '#37b679';
export const SOURCE_OUTLINE = '#25904f';

export const SINK_FILL = '#4ea8de';
export const SINK_OUTLINE = '#2e82b5';

export const EXCLUDED_FILL = '#b9c4c4';
export const EXCLUDED_OUTLINE = '#94a3a3';

export const SELECT_RING = '#0f9c94';
export const HOVER_FILL = 'rgba(15, 156, 148, 0.12)';

export const LABEL_INK = '#20302f';

/** Low(cool blue) -> high(warm red) pressure ramp, perceptually ordered. */
const PRESSURE_STOPS: Array<[number, [number, number, number]]> = [
  [0.0, [40, 90, 210]], // deep blue (low)
  [0.25, [40, 190, 220]], // cyan
  [0.5, [70, 200, 120]], // green
  [0.75, [240, 200, 60]], // yellow
  [1.0, [225, 60, 60]], // red (high)
];

/** Perceptual pressure ramp: t in [0,1] -> "rgb(r,g,b)". Pure function, no Canvas/DOM dependency. */
export function pressureColor(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 0; i < PRESSURE_STOPS.length - 1; i++) {
    const [t0, c0] = PRESSURE_STOPS[i];
    const [t1, c1] = PRESSURE_STOPS[i + 1];
    if (x >= t0 && x <= t1) {
      const f = (x - t0) / (t1 - t0);
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * f);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * f);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * f);
      return `rgb(${r}, ${g}, ${b})`;
    }
  }
  const [, c] = PRESSURE_STOPS[PRESSURE_STOPS.length - 1];
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
