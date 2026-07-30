/**
 * The local structure of the flow *inside* a link — what the solver's single
 * bulk velocity per link leaves out, and what makes the animation read as a
 * fluid rather than a conveyor belt.
 *
 * Three effects live here:
 *
 *  - **Velocity profile.** Turbulent pipe flow is not plug flow: it follows
 *    roughly the 1/7-power law, fast in the core and stalled at the wall. Two
 *    particles side by side therefore separate as they travel, which is what
 *    shear looks like.
 *  - **Cross-stream mixing.** Turbulence continuously swaps fluid between the
 *    core and the wall, so a particle does not stay in its lane — without this
 *    the profile would sort particles permanently by speed and the wall layer
 *    would silt up.
 *  - **The vena contracta at a throttled valve.** A valve's opening does not
 *    just add resistance; it squeezes the stream through a small gap, and
 *    continuity means what goes through that gap goes *fast*. The gap velocity
 *    is `V_pipe / θ`, where θ is the valve's effective flow-area fraction, so
 *    as a valve shuts and Q falls, the jet through it stays quick while
 *    everything downstream slows and empties. That contrast is the whole point
 *    of the feature — and it comes out of the flow-area relation, not a
 *    hand-tuned "throttled" animation.
 *
 * These modulate a visualization, not the solve: the solver's flows and
 * velocities are untouched, and nothing here feeds back into the physics.
 */

import { NetworkLink } from '../domain/network';
import { VALVE_SPECS, characteristicFraction } from '../domain/catalog/valves';

/** Exponent of the turbulent power-law profile, v/v_max = (1 - |u|)^(1/n). */
const PROFILE_N = 7;
/**
 * Mean of that profile along a *diameter*: ∫₀¹ (1−u)^(1/n) du = n/(n+1).
 *
 * Not the usual area-weighted 2n²/((n+1)(2n+1)): the board is a side view, so
 * particles are spread uniformly across the projected width rather than
 * uniformly over the circular area. Normalising by the matching (line) mean
 * is what makes the *average* particle travel at exactly the bulk velocity
 * the solver computed, which is the property the animation has to preserve.
 */
const PROFILE_LINE_MEAN = PROFILE_N / (PROFILE_N + 1);
/** Keep particles off the exact wall, where the power law gives zero speed. */
const MAX_OFFSET = 0.97;

/**
 * How fast a particle at lateral position `u` (0 = centreline, ±1 = wall)
 * travels, as a multiple of the link's bulk velocity. Averaged over a
 * uniformly-spread set of offsets this returns 1, so adding a profile changes
 * how the stream moves without changing how fast it moves overall.
 */
export function profileSpeedFactor(u: number): number {
  const y = 1 - Math.min(Math.abs(u), MAX_OFFSET);
  return Math.pow(y, 1 / PROFILE_N) / PROFILE_LINE_MEAN;
}

/**
 * Standard deviation of the lateral random walk per sqrt(cell) of axial
 * travel. Mixing scales with distance covered, not with time — a fast stream
 * and a slow one mix over the same number of pipe diameters — so the walk is
 * driven by how far the particle actually moved this frame.
 *
 * At 0.35 a particle wanders the full bore in roughly 8 cells of travel, which
 * matches the tens-of-diameters mixing length of real turbulent pipe flow
 * closely enough to look right. This is a visual calibration, not a modelled
 * eddy diffusivity.
 */
const MIX_PER_SQRT_CELL = 0.35;

/** Gaussian-ish sample (sum of three uniforms), unit variance. */
function gaussian(rand: () => number): number {
  return (rand() + rand() + rand() - 1.5) * 2;
}

/**
 * Advance a particle's lateral position by one step of turbulent mixing,
 * reflecting off the pipe wall. `cellsMoved` is the axial distance covered.
 */
export function mixLateral(u: number, cellsMoved: number, rand: () => number): number {
  if (cellsMoved <= 0) return u;
  let next = u + gaussian(rand) * MIX_PER_SQRT_CELL * Math.sqrt(cellsMoved);
  // Reflect at both walls (possibly repeatedly, after a very large step).
  for (let i = 0; i < 4 && (next > 1 || next < -1); i++) {
    next = next > 1 ? 2 - next : -2 - next;
  }
  return Math.max(-1, Math.min(1, next));
}

/**
 * Effective flow-area fraction of a link (1 = full bore). Only a throttled
 * valve is below 1; a pipe or a pump passes its whole bore.
 */
export function linkOpenFraction(link: NetworkLink): number {
  if (link.kind !== 'valve') return 1;
  return characteristicFraction(VALVE_SPECS[link.valveType].characteristic, link.opening);
}

/** Cap on the jet speed-up, so a nearly-shut valve does not fling particles
 *  across the board faster than the eye can track. */
const MAX_JET_FACTOR = 8;
/** Smallest drawn jet width, as a fraction of the bore. */
const MIN_JET_WIDTH = 0.12;
/** Where along the link the gap sits, and how the jet builds and decays. A
 *  jet accelerates into the gap over a short distance and dissipates over a
 *  longer one, so the bell is deliberately skewed downstream. */
const THROAT_S = 0.5;
const RISE_WIDTH = 0.18;
const DECAY_WIDTH = 0.3;

function rawBell(s: number): number {
  const d = s - THROAT_S;
  const w = d < 0 ? RISE_WIDTH : DECAY_WIDTH;
  return Math.exp(-(d * d) / (w * w));
}

/** Largest value the raw bell still has at either end of the link. */
const BELL_END = Math.max(rawBell(0), rawBell(1));

/**
 * Bell centred on the throat: exactly 1 at the gap and exactly 0 at both ends
 * of the link. Pinning the ends to zero matters — the neighbouring pipe link
 * animates at plain bulk speed, so any residual jet left at the tile boundary
 * would show up as a visible speed seam where the two links meet.
 */
function throatBell(s: number): number {
  return Math.max(0, (rawBell(s) - BELL_END) / (1 - BELL_END));
}

/**
 * Speed multiplier along a link, relative to its bulk velocity. 1 everywhere
 * except through a throttled valve's gap, where continuity through the reduced
 * area gives `V_gap = V_pipe / θ`.
 */
export function throatSpeedFactor(openFraction: number, s: number): number {
  if (openFraction >= 1) return 1;
  const jet = Math.min(1 / Math.max(openFraction, 1 / MAX_JET_FACTOR), MAX_JET_FACTOR);
  return 1 + (jet - 1) * throatBell(s);
}

/**
 * How wide the stream is at `s`, as a fraction of the bore. The streamlines
 * converge into a throttled valve's gap and spread again downstream — the
 * visible signature of throttling, and the reason a nearly-shut valve reads as
 * a thin bright thread instead of a full-bore column that happens to be slow.
 */
export function throatContraction(openFraction: number, s: number): number {
  if (openFraction >= 1) return 1;
  const width = Math.max(Math.sqrt(openFraction), MIN_JET_WIDTH);
  return 1 + (width - 1) * throatBell(s);
}
