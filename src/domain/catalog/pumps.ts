/**
 * Pump catalog — centrifugal pump model.
 *
 * How a centrifugal pump actually works, since the whole model follows from
 * it: the impeller does not push a slug of liquid down the discharge. It
 * flings liquid outward, which leaves a *low pressure* region at the impeller
 * eye. Ambient pressure on the supply surface (atmosphere, or a pressurized
 * vessel) is what pushes liquid up the suction line into that region. So:
 *
 *  - The pump is directional. One port is suction, the other discharge, and
 *    the machine only produces head in that direction (see `checkValve` on
 *    PumpLink — a stopped or reverse-driven pump is a blocked line, not a
 *    bypass).
 *  - Its ability to "pull" is bounded by absolute pressure, not by the motor.
 *    Available head at the eye (NPSHa) must exceed what the impeller needs
 *    (NPSHr) or the liquid flashes to vapor at the eye and the head collapses
 *    — see `suctionHeadFactor`. This is why suction lift tops out near 10.3 m
 *    in theory and ~6-7 m in practice, no matter how big the motor is.
 *  - Shaft power does not vanish when the discharge is shut. At zero flow the
 *    pump still absorbs roughly half its BEP power, and with no throughflow to
 *    carry it away, all of it heats the liquid trapped in the casing — the
 *    churn / deadhead ("공회전") damage mechanism modeled by
 *    `pumpShaftPower` + `churnTempRiseRate`.
 *
 * The head-flow curve is the quadratic H(Q) = a0 - a1*Q - a2*Q^2, fitted from
 * three catalogue points (shutoff, best-efficiency point, runout). The BEP is
 * carried explicitly so the analyzer can warn when the duty point drifts
 * outside the recommended 70-120% window (Hydraulic Institute guidance).
 */

import { G, ATM } from '../units';
import { solveLinearSystem } from '../../physics/linalg';

export interface PumpCurvePoint {
  /** Volumetric flow [m^3/s]. */
  q: number;
  /** Total head [m]. */
  h: number;
}

export interface PumpSpec {
  name: string;
  /** Head curve coefficients: H = a0 - a1*Q - a2*Q^2  (Q in m^3/s). */
  a0: number;
  a1: number;
  a2: number;
  /** Best-efficiency-point flow [m^3/s]. */
  bepFlow: number;
  /** NPSH required at BEP [m]. */
  npshrAtBep: number;
  /** Rotor polar moment of inertia [kg.m^2] (for trip transients). */
  inertia: number;
  /** Rated speed [rev/min]. */
  ratedRpm: number;
  /**
   * Efficiency at the BEP (0..1). Optional: a pump spec is stored inline in
   * saved projects, so every field added after v1 has to read back as a
   * default rather than as `undefined` — see `bepEfficiency()`.
   */
  bepEfficiencyPct?: number;
  /**
   * Liquid volume trapped inside the casing [m^3]. Sets how fast a churning
   * (shut-discharge) pump heats that liquid up. Optional; see `casingVolume()`.
   */
  casingVolumeM3?: number;
}

/** Typical BEP efficiency for a mid-size end-suction pump when unspecified. */
const DEFAULT_BEP_EFFICIENCY = 0.75;
/** Typical casing hold-up [m^3] when unspecified. */
const DEFAULT_CASING_VOLUME = 0.02;
/**
 * Shaft power a radial-flow centrifugal absorbs at shutoff, as a fraction of
 * its BEP shaft power. Radial impellers have a rising power curve; 40-60% at
 * churn is the usual range, so the mid-point is used.
 */
const SHUTOFF_POWER_FRACTION = 0.5;
/** Specific heat of water [J/(kg.K)] — used for the churn temperature rise. */
export const WATER_CP = 4186;

export const bepEfficiency = (spec: PumpSpec): number => spec.bepEfficiencyPct ?? DEFAULT_BEP_EFFICIENCY;
export const casingVolume = (spec: PumpSpec): number => spec.casingVolumeM3 ?? DEFAULT_CASING_VOLUME;

/**
 * Fit H(Q) = a0 - a1*Q - a2*Q^2 through three points. Returns {a0,a1,a2}.
 * Solves the 3x3 Vandermonde-like system:  H = a0 - a1*Q - a2*Q^2.
 */
export function fitPumpCurve(pts: [PumpCurvePoint, PumpCurvePoint, PumpCurvePoint]): {
  a0: number;
  a1: number;
  a2: number;
} {
  // Unknown vector x = [a0, a1, a2]; equation: a0 - a1*q - a2*q^2 = h.
  const A = pts.map((p) => [1, -p.q, -(p.q * p.q)]);
  const b = pts.map((p) => p.h);
  const x = solveLinearSystem(A, b);
  return { a0: x[0], a1: x[1], a2: x[2] };
}

/** Head [m] delivered by a pump at flow q [m^3/s] and speed ratio n (1 = rated). */
export function pumpHead(spec: PumpSpec, q: number, n = 1): number {
  // Affinity laws: H scales with n^2, Q with n. Evaluate the rated curve at
  // the equivalent rated flow q/n, then scale head by n^2.
  if (n <= 1e-6) return 0;
  const qEq = q / n;
  const hRated = spec.a0 - spec.a1 * qEq - spec.a2 * qEq * qEq;
  return n * n * hRated;
}

/** d(head)/dQ [m / (m^3/s)] at flow q and speed ratio n — used by the solver. */
export function pumpHeadSlope(spec: PumpSpec, q: number, n = 1): number {
  if (n <= 1e-6) return 0;
  const qEq = q / n;
  // dH/dQ = n^2 * d(hRated)/dqEq * dqEq/dQ = n^2 * (-a1 - 2 a2 qEq) * (1/n)
  return n * (-spec.a1 - 2 * spec.a2 * qEq);
}

// --- Suction side: what the pump can actually pull ------------------------

/**
 * NPSH required [m] at flow q. NPSHr grows roughly with the square of flow
 * (the eye velocity head the impeller has to overcome), so a pump run far past
 * BEP needs far more suction pressure than its catalogue NPSHr suggests. Under
 * the affinity laws the n^2 head scaling and the (q/n)^2 flow scaling cancel,
 * which is why speed does not appear here.
 *
 * Floored at a quarter of the BEP value: near shutoff the eye still has to be
 * fed, and a literal zero would say a deadheaded pump can never cavitate.
 */
export function pumpNpshRequired(spec: PumpSpec, q: number): number {
  if (spec.bepFlow <= 0) return spec.npshrAtBep;
  const ratio = Math.abs(q) / spec.bepFlow;
  return spec.npshrAtBep * Math.max(0.25, ratio * ratio);
}

/**
 * NPSH available [m] at a pump suction: how much absolute head the liquid has
 * at the impeller eye above its own vapor pressure.
 *
 *   NPSHa = (p_atm - p_vapor)/(rho g) + (H_suction - z_suction)
 *
 * The second term is the suction *gauge* head, which is where lift shows up:
 * a source below the pump makes it negative and eats into the atmospheric
 * allowance, which is exactly why suction lift has a hard ceiling near
 * 10.3 m of water at sea level and much less once vapor pressure and friction
 * are taken off.
 */
export function npshAvailable(suctionGaugeHead: number, rho: number, pv: number): number {
  return (ATM - pv) / (rho * G) + suctionGaugeHead;
}

/**
 * Fraction of curve head a pump still delivers given its suction condition
 * (1 = full head, 0 = fully broken down / running dry).
 *
 * By definition NPSHr is the 3%-head-drop point, not the point where the pump
 * stops: performance falls off below it and collapses completely somewhat
 * lower. The breakdown is modeled as linear between NPSHr and half of NPSHr,
 * an engineering approximation of the measured knee — it is deliberately not
 * a cliff, so the solver sees a continuous function and a marginal suction
 * shows up as a pump that under-delivers rather than one that trips off.
 */
/**
 * At or below this suction head factor the pump is effectively running dry —
 * vapor-bound, making no head and passing no liquid. Shared by the solver
 * (which then treats the pump as a blocked line) and the health analyzer
 * (which reports it), so the two cannot disagree about what "dry" means.
 */
export const DRY_SUCTION_FACTOR = 0.02;

export function suctionHeadFactor(npshA: number, npshR: number): number {
  if (npshR <= 0) return 1;
  if (npshA >= npshR) return 1;
  const floor = 0.5 * npshR;
  if (npshA <= floor) return 0;
  return (npshA - floor) / (npshR - floor);
}

// --- Power side: what the motor puts in, and where it goes ----------------

/**
 * Shaft power [W] absorbed at flow q and speed ratio n.
 *
 * A radial-flow impeller has a near-linear power characteristic between
 * shutoff and BEP, so power is interpolated on that line rather than derived
 * from rho g Q H / eta — which is 0/0 at shutoff and would wrongly say a
 * deadheaded pump absorbs nothing. Power scales with n^3 (affinity).
 */
export function pumpShaftPower(spec: PumpSpec, q: number, n: number, rho: number): number {
  if (n <= 1e-6) return 0;
  const bepHead = spec.a0 - spec.a1 * spec.bepFlow - spec.a2 * spec.bepFlow * spec.bepFlow;
  const bepPower = (rho * G * spec.bepFlow * bepHead) / bepEfficiency(spec);
  const shutoffPower = SHUTOFF_POWER_FRACTION * bepPower;
  // Ratio against the *rated* curve position (q/n), so the affinity scaling
  // below is applied exactly once.
  const ratio = spec.bepFlow > 0 ? Math.max(0, Math.abs(q) / n) / spec.bepFlow : 0;
  const ratedPower = shutoffPower + (bepPower - shutoffPower) * ratio;
  return Math.max(0, ratedPower) * n * n * n;
}

/**
 * Rate of temperature rise [K/s] of the liquid held in the casing when the
 * pump churns. `heatPower` is the shaft power that does not leave as useful
 * hydraulic work; with no throughflow it all lands in the trapped liquid.
 */
export function churnTempRiseRate(spec: PumpSpec, heatPower: number, rho: number): number {
  const mass = rho * casingVolume(spec);
  return mass > 0 ? heatPower / (mass * WATER_CP) : 0;
}

/**
 * Minimum continuous flow [m^3/s] needed to carry `heatPower` away within an
 * allowable temperature rise — the thermal minimum-flow criterion that sets
 * how big a pump's recirculation line has to be.
 */
export function thermalMinimumFlow(heatPower: number, rho: number, allowableRiseK: number): number {
  if (allowableRiseK <= 0) return Infinity;
  return heatPower / (rho * WATER_CP * allowableRiseK);
}

/** Build a pump spec from three catalogue points plus metadata. */
export function makePump(
  name: string,
  points: [PumpCurvePoint, PumpCurvePoint, PumpCurvePoint],
  meta: {
    bepFlow: number;
    npshrAtBep: number;
    inertia: number;
    ratedRpm: number;
    bepEfficiencyPct?: number;
    casingVolumeM3?: number;
  },
): PumpSpec {
  const { a0, a1, a2 } = fitPumpCurve(points);
  return { name, a0, a1, a2, ...meta };
}

/**
 * A representative end-suction process pump: ~50 m shutoff, BEP near
 * 100 m^3/h at ~45 m. Points are (shutoff, BEP, runout).
 */
export const PUMP_50M: PumpSpec = makePump(
  'Booster 50m',
  [
    { q: 0, h: 52 },
    { q: 100 / 3600, h: 45 },
    { q: 160 / 3600, h: 28 },
  ],
  {
    bepFlow: 100 / 3600,
    npshrAtBep: 3.5,
    inertia: 0.9,
    ratedRpm: 2950,
    bepEfficiencyPct: 0.75,
    casingVolumeM3: 0.02,
  },
);
