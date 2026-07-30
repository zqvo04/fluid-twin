/**
 * Canvas draw colors for the grid. Mirrors the soft/playful palette in
 * tokens.css but as plain JS constants — reading CSS custom properties back
 * out for every Canvas fillStyle would add a layer of indirection for no
 * benefit. The one exception is the board background/grid lines, which do
 * need to flip with the light/dark theme (unlike the vivid pipe/valve/pump
 * accent colors, which read fine against either).
 */

const CANVAS_BG_LIGHT = '#eaf7f6';
const GRID_LINE_LIGHT = '#cfe8e6';
const GRID_LINE_STRONG_LIGHT = '#b9dcda';

const CANVAS_BG_DARK = '#16211f';
const GRID_LINE_DARK = '#22322f';
const GRID_LINE_STRONG_DARK = '#2c433e';

function isDarkMode(): boolean {
  if (typeof document === 'undefined') return false;
  const explicit = document.documentElement.getAttribute('data-theme');
  if (explicit === 'dark') return true;
  if (explicit === 'light') return false;
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

export function canvasBg(): string {
  return isDarkMode() ? CANVAS_BG_DARK : CANVAS_BG_LIGHT;
}

export function gridLine(): string {
  return isDarkMode() ? GRID_LINE_DARK : GRID_LINE_LIGHT;
}

export function gridLineStrong(): string {
  return isDarkMode() ? GRID_LINE_STRONG_DARK : GRID_LINE_STRONG_LIGHT;
}

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

function pressureRgb(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 0; i < PRESSURE_STOPS.length - 1; i++) {
    const [t0, c0] = PRESSURE_STOPS[i];
    const [t1, c1] = PRESSURE_STOPS[i + 1];
    if (x >= t0 && x <= t1) {
      const f = (x - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ];
    }
  }
  return PRESSURE_STOPS[PRESSURE_STOPS.length - 1][1];
}

/** Perceptual pressure ramp: t in [0,1] -> "rgb(r,g,b)". Pure function, no Canvas/DOM dependency. */
export function pressureColor(t: number): string {
  const [r, g, b] = pressureRgb(t);
  return `rgb(${r}, ${g}, ${b})`;
}

/** A darker shade of the same pressure color, for the tile outline. */
export function pressureOutlineColor(t: number): string {
  const [r, g, b] = pressureRgb(t);
  return `rgb(${Math.round(r * 0.65)}, ${Math.round(g * 0.65)}, ${Math.round(b * 0.65)})`;
}

export const CAVITATION_WARNING = '#8b2fc9';

/** Pump stress ring: green while healthy, through amber, to red as the duty
 *  point moves toward something that destroys the machine. */
export const PUMP_STRESS_OK = '#1f9d55';
export const PUMP_STRESS_WARN = '#e0a100';
export const PUMP_STRESS_CRITICAL = '#d93a2b';

export function pumpStressColor(stress: number): string {
  if (stress >= 0.66) return PUMP_STRESS_CRITICAL;
  if (stress >= 0.25) return PUMP_STRESS_WARN;
  return PUMP_STRESS_OK;
}
