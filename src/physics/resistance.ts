/**
 * Link resistance model — converts each network link into the two quantities
 * the steady-state solver needs at a given flow Q:
 *   g(Q)      head loss H_from - H_to  [m]
 *   g'(Q)     d(head loss)/dQ          [m / (m^3/s)]  (Jacobian diagonal)
 *
 * A "compiled link" precomputes the size/geometry-dependent constants once, so
 * the Newton iteration only evaluates cheap arithmetic. This same flattened
 * form is what will be shipped to the Web Worker for transient analysis.
 */

import { G } from '../domain/units';
import { FluidState } from '../domain/fluid';
import { pipeGeometry } from '../domain/catalog/pipes';
import { fittingK } from '../domain/catalog/fittings';
import { valveK } from '../domain/catalog/valves';
import {
  DRY_SUCTION_FACTOR,
  PumpSpec,
  npshAvailable,
  pumpHead,
  pumpHeadSlope,
  pumpNpshRequired,
  suctionHeadFactor,
} from '../domain/catalog/pumps';
import { NetworkLink, PipelineNetwork, hasCheckValve, linkLength, nodeById } from '../domain/network';

/** Minimum Jacobian magnitude — keeps the Newton step well-conditioned near Q=0. */
const MIN_SLOPE = 1e-4;

/** Below this fraction of rated speed, a pump is treated as stopped rather
 * than evaluated on its head curve (see PUMP_BLOCKED_R below). */
const PUMP_STOPPED_SPEED = 0.02;

/**
 * Blocked-line resistance for a stopped pump. A stationary impeller — and,
 * in nearly every real installation, a discharge check valve — keeps a
 * stopped pump from acting as a zero-resistance bypass; without this, a
 * network with an idle pump flows through it exactly as if it were open
 * pipe. This value is large enough that any credible network flow produces
 * a head loss of many hundreds of metres (forcing Q -> 0) while staying
 * finite, the same convention and magnitude used for a fully closed valve
 * (see rFixed/kCapped below). The same value blocks reverse flow through a
 * discharge check valve and a vapor-bound (dry) pump.
 * Speed ratio is fixed for the duration of a solve (only flow is the Newton
 * unknown), so branching on it here can't introduce a mid-iteration
 * discontinuity the way branching on flow sign would.
 */
const PUMP_BLOCKED_R = 1e12;

interface CompiledPipe {
  kind: 'resistive';
  /** r such that g = r * Q|Q|  (friction is recomputed each eval; see below). */
  area: number;
  diameter: number;
  length: number;
  relRough: number;
  minorK: number;
}

interface CompiledValve {
  kind: 'valve';
  area: number;
  /** Position-fixed resistance coefficient K / (2 g A^2). */
  rFixed: number;
}

/**
 * Relaxation applied to NPSH available between Newton iterations. NPSHa is
 * read off the suction head, which the same Newton loop is still solving for,
 * so feeding it back undamped can chatter between "cavitating" and "not".
 * Blending with the previous iteration's value turns that into a smooth
 * fixed-point sweep. (The much stronger feedback — NPSHr rising with flow —
 * is handled exactly, in the Jacobian, rather than by damping.)
 */
const NPSHA_RELAX = 0.3;

interface CompiledPump {
  kind: 'pump';
  spec: PumpSpec;
  speedRatio: number;
  /** Blocks reverse flow (the discharge check valve). */
  checkValve: boolean;
  /** Suction node elevation [m], for turning its total head into NPSHa. */
  suctionElevation: number;
  /**
   * Relaxed NPSH available [m], carried across Newton iterations for the
   * damping above. Mutable solver state, not a property of the pump; NaN
   * until the first evaluation seeds it.
   */
  npshA: number;
}

export interface CompiledLink {
  id: string;
  fromIndex: number;
  toIndex: number;
  data: CompiledPipe | CompiledValve | CompiledPump;
}

export interface EvalResult {
  /** Head loss H_from - H_to [m]. */
  g: number;
  /** d(head loss)/dQ [m/(m^3/s)], floored in magnitude for stability. */
  dgdQ: number;
  /**
   * How far the link's own relaxed internal state still has to travel this
   * iteration (a pump's NPSHa, in metres; 0 for every other link). The solver
   * has to see this settle before declaring convergence: a heavily relaxed
   * state can crawl slowly enough that the flow correction alone looks
   * converged while the answer is still moving.
   */
  stateResidual: number;
}

// Static friction is recomputed inside evaluate() for pipes because it depends
// on Q; the module import is done there.
import { reynolds, churchillFriction } from './friction';

export function compileLink(
  net: PipelineNetwork,
  link: NetworkLink,
  nodeIndex: Map<string, number>,
): CompiledLink {
  const fromIndex = nodeIndex.get(link.from)!;
  const toIndex = nodeIndex.get(link.to)!;

  if (link.kind === 'pipe') {
    const geo = pipeGeometry(link.nps, link.schedule);
    const minorK = (link.fittings ?? []).reduce((sum, f) => sum + fittingK(f, link.nps), 0);
    const data: CompiledPipe = {
      kind: 'resistive',
      area: geo.area,
      diameter: geo.id,
      length: linkLength(net, link),
      // Relative roughness of the material (A106-B carbon steel) over the bore.
      relRough: 0.045e-3 / geo.id,
      minorK,
    };
    return { id: link.id, fromIndex, toIndex, data };
  }

  if (link.kind === 'valve') {
    const geo = pipeGeometry(link.nps, link.schedule);
    const k = valveK(link.valveType, link.nps, link.schedule, link.opening);
    // Cap a "closed" valve at a very large but finite resistance so the solver
    // stays well-posed (a truly infinite K would decouple the branch).
    const kCapped = Number.isFinite(k) ? k : 1e12;
    const rFixed = kCapped / (2 * G * geo.area * geo.area);
    const data: CompiledValve = { kind: 'valve', area: geo.area, rFixed };
    return { id: link.id, fromIndex, toIndex, data };
  }

  // pump
  const data: CompiledPump = {
    kind: 'pump',
    spec: link.spec,
    speedRatio: link.speedRatio,
    checkValve: hasCheckValve(link),
    suctionElevation: nodeById(net, link.from).position.y,
    npshA: NaN,
  };
  return { id: link.id, fromIndex, toIndex, data };
}

/**
 * How much of its curve head a pump can actually make, given the total head
 * currently standing at its suction node — 1 when NPSHa comfortably exceeds
 * NPSHr, falling toward 0 as the suction is starved.
 *
 * `dfdq` matters as much as the factor itself. NPSHr grows with Q^2, so more
 * flow means a hungrier impeller: the factor falls as flow rises, which is a
 * strongly *negative* feedback. Left as an outer fixed point it makes the
 * solver hunt between "cavitating" and "not"; returned as a derivative it
 * lands in the Jacobian diagonal, where it correctly stiffens the link and
 * converges. The residual dependence on the head field (through NPSHa) is
 * comparatively weak and stays a relaxed fixed point.
 *
 * `suctionHead === undefined` means the caller is not solving a head field (a
 * unit test evaluating one link in isolation): the suction is then taken as
 * adequate rather than guessed at.
 */
function pumpSuction(
  d: CompiledPump,
  q: number,
  fluid: FluidState,
  suctionHead?: number,
): { factor: number; dfdq: number; drift: number } {
  if (suctionHead === undefined || !Number.isFinite(suctionHead)) return { factor: 1, dfdq: 0, drift: 0 };

  const raw = npshAvailable(suctionHead - d.suctionElevation, fluid.rho, fluid.pv);
  const drift = Number.isFinite(d.npshA) ? Math.abs(raw - d.npshA) : Infinity;
  d.npshA = Number.isFinite(d.npshA) ? d.npshA + NPSHA_RELAX * (raw - d.npshA) : raw;

  const npshR = pumpNpshRequired(d.spec, q);
  const factor = suctionHeadFactor(d.npshA, npshR);
  if (factor <= 0 || factor >= 1) return { factor, dfdq: 0, drift };

  // Inside the breakdown band, suctionHeadFactor is f = 2*NPSHa/NPSHr - 1, so
  // df/dQ = -2*NPSHa/NPSHr^2 * dNPSHr/dQ with dNPSHr/dQ = 2*npshr_bep*Q/Qbep^2
  // (the Q^2 law, which is what applies whenever the factor is in this band).
  const qb = d.spec.bepFlow;
  if (qb <= 0) return { factor, dfdq: 0, drift };
  const dNpshRdq = (2 * d.spec.npshrAtBep * q) / (qb * qb);
  return { factor, dfdq: (-2 * d.npshA * dNpshRdq) / (npshR * npshR), drift };
}

/**
 * Evaluate g(Q) and g'(Q) for a compiled link at flow Q, fluid state fluid.
 * `suctionHead` is the total head [m] currently at the link's `from` node; it
 * only matters for pumps, where it decides whether the suction can keep the
 * impeller fed (NPSH).
 */
export function evaluateLink(
  link: CompiledLink,
  q: number,
  fluid: FluidState,
  suctionHead?: number,
): EvalResult {
  const d = link.data;

  if (d.kind === 'resistive') {
    const re = reynolds(q, d.diameter, fluid.rho, fluid.mu);
    const f = churchillFriction(re, d.relRough);
    const rFriction = (f * d.length) / (d.diameter * 2 * G * d.area * d.area);
    const rMinor = d.minorK / (2 * G * d.area * d.area);
    const r = rFriction + rMinor;
    const g = r * q * Math.abs(q);
    // dg/dQ = 2 r |Q|; friction's slow Q-dependence is neglected (standard GGA).
    const dgdQ = Math.max(2 * r * Math.abs(q), MIN_SLOPE);
    return { g, dgdQ, stateResidual: 0 };
  }

  if (d.kind === 'valve') {
    const g = d.rFixed * q * Math.abs(q);
    const dgdQ = Math.max(2 * d.rFixed * Math.abs(q), MIN_SLOPE);
    return { g, dgdQ, stateResidual: 0 };
  }

  // pump, stopped: blocked line, not a free bypass (see PUMP_BLOCKED_R).
  if (d.speedRatio <= PUMP_STOPPED_SPEED) {
    const g = PUMP_BLOCKED_R * q * Math.abs(q);
    const dgdQ = Math.max(2 * PUMP_BLOCKED_R * Math.abs(q), MIN_SLOPE);
    return { g, dgdQ, stateResidual: 0 };
  }

  // pump, running. Head loss = -(pump head): the derivative sign flips so the
  // Jacobian diagonal stays positive (pump head falls with flow, -dH/dQ > 0).
  // The curve is scaled by the suction factor, so a pump asked to lift more
  // than atmospheric pressure allows delivers progressively less head and,
  // once the suction breaks down entirely, none at all — a running-dry pump
  // that moves nothing, which is what actually happens.
  const { factor, dfdq, drift } = pumpSuction(d, q, fluid, suctionHead);
  const shutoffHead = factor * pumpHead(d.spec, 0, d.speedRatio);

  // Reverse flow. A pump is a one-way machine: its head curve says nothing
  // about being driven backwards (that is the four-quadrant model, out of
  // scope), so this branch is a resistance, never a mirrored curve.
  //  - With the usual discharge check valve, it is blocked like a shut valve.
  //  - Without one, the spinning impeller is still a substantial obstruction:
  //    it is charged a quadratic resistance scaled so that reversing at BEP
  //    flow costs about the pump's own shutoff head.
  // Both are anchored at -shutoffHead so g stays continuous through Q = 0 —
  // the pump keeps pushing forward at shutoff while the reverse flow is held
  // back, instead of its head gain vanishing the instant flow changes sign.
  if (q < 0) {
    const qb = d.spec.bepFlow;
    const rReverse =
      d.checkValve || qb <= 0 ? PUMP_BLOCKED_R : Math.max(d.spec.a0, 0) / (qb * qb) + MIN_SLOPE;
    const g = -shutoffHead + rReverse * q * Math.abs(q);
    const dgdQ = Math.max(2 * rReverse * Math.abs(q), MIN_SLOPE);
    return { g, dgdQ, stateResidual: drift };
  }

  // A pump whose suction has broken down completely is vapor-bound: it makes
  // no head *and* passes nothing, so it is a blocked line, not the free
  // bypass a plain zero-head link would be (same reasoning as a stopped pump).
  if (factor <= DRY_SUCTION_FACTOR) {
    const g = PUMP_BLOCKED_R * q * Math.abs(q);
    const dgdQ = Math.max(2 * PUMP_BLOCKED_R * Math.abs(q), MIN_SLOPE);
    return { g, dgdQ, stateResidual: drift };
  }

  // Past runout the curve head goes negative and the pump is a resistance;
  // suction degradation only ever reduces head the pump *makes*, so it is not
  // applied there (scaling a negative head would flip the Jacobian sign).
  const curveHead = pumpHead(d.spec, q, d.speedRatio);
  const producing = curveHead > 0;
  const eff = producing ? factor : 1;
  const g = -eff * curveHead;
  // Product rule on H_eff = factor(Q) * H_curve(Q).
  const slope = eff * pumpHeadSlope(d.spec, q, d.speedRatio) + (producing ? dfdq * curveHead : 0);
  const dgdQ = Math.max(-slope, MIN_SLOPE);
  return { g, dgdQ, stateResidual: drift };
}
