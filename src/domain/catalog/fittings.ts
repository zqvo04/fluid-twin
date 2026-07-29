/**
 * Fitting catalog — Crane TP-410 resistance coefficients for the standard
 * bends and branches. Each fitting's K is a multiple of the size-dependent
 * fully-turbulent friction factor fT.
 */

import { FRICTION_FACTOR_FT, NominalSize } from './pipes';

export type FittingType = 'elbow90' | 'elbow45' | 'teeRun' | 'teeBranch' | 'entrance' | 'exit';

// K = kOverFt * fT, except entrance/exit which are (near) Reynolds-independent.
const K_OVER_FT: Record<FittingType, number> = {
  elbow90: 30,
  elbow45: 16,
  teeRun: 20,
  teeBranch: 60,
  entrance: 0, // handled as fixed K below
  exit: 0,
};

// Fixed K values independent of fT.
const K_FIXED: Partial<Record<FittingType, number>> = {
  entrance: 0.5, // sharp-edged inlet
  exit: 1.0, // discharge to a large reservoir
};

export function fittingK(type: FittingType, nps: NominalSize): number {
  const fixed = K_FIXED[type];
  if (fixed !== undefined) return fixed;
  return K_OVER_FT[type] * FRICTION_FACTOR_FT[nps];
}

/**
 * Wall-impact coefficient for the pressure-field renderer (render/pressureField.ts),
 * NOT a physics input to the solver — the solver already accounts for every
 * fitting's loss correctly via fittingK/minorK. This scales how much of the
 * local velocity head (0.5 rho V^2) is added back on top of static pressure
 * to indicate impingement/stagnation loading on a fitting's outer wall (e.g.
 * the outer wall of an elbow sees a real, if localized, pressure rise from
 * flow curvature — dp/dr = rho V^2/r — even though the bulk static pressure
 * trends downward through the fitting). 1.0 = full stagnation-pressure rise
 * (a defensible upper bound, not a CFD result); 0 = no added indicator
 * (straight pipe, no impingement).
 */
export const IMPACT_COEFFICIENT: Record<FittingType, number> = {
  elbow90: 1.0,
  elbow45: 0.5,
  teeRun: 0.2,
  teeBranch: 1.0,
  entrance: 0,
  exit: 0,
};
