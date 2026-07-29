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
import { PumpSpec, pumpHead, pumpHeadSlope } from '../domain/catalog/pumps';
import { NetworkLink, PipelineNetwork, linkLength } from '../domain/network';

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
 * a multi-hundred-meter head loss (forcing Q -> 0) while staying finite, the
 * same convention used for a fully closed valve (see rFixed/kCapped below).
 * Speed ratio is fixed for the duration of a solve (only flow is the Newton
 * unknown), so branching on it here can't introduce a mid-iteration
 * discontinuity the way branching on flow sign would.
 */
const PUMP_BLOCKED_R = 1e9;

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

interface CompiledPump {
  kind: 'pump';
  spec: PumpSpec;
  speedRatio: number;
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
  const data: CompiledPump = { kind: 'pump', spec: link.spec, speedRatio: link.speedRatio };
  return { id: link.id, fromIndex, toIndex, data };
}

/** Evaluate g(Q) and g'(Q) for a compiled link at flow Q, fluid state fluid. */
export function evaluateLink(link: CompiledLink, q: number, fluid: FluidState): EvalResult {
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
    return { g, dgdQ };
  }

  if (d.kind === 'valve') {
    const g = d.rFixed * q * Math.abs(q);
    const dgdQ = Math.max(2 * d.rFixed * Math.abs(q), MIN_SLOPE);
    return { g, dgdQ };
  }

  // pump, stopped: blocked line, not a free bypass (see PUMP_BLOCKED_R).
  if (d.speedRatio <= PUMP_STOPPED_SPEED) {
    const g = PUMP_BLOCKED_R * q * Math.abs(q);
    const dgdQ = Math.max(2 * PUMP_BLOCKED_R * Math.abs(q), MIN_SLOPE);
    return { g, dgdQ };
  }

  // pump, running: head loss = -(pump head). Derivative sign flips so the
  // diagonal stays positive (pump head falls with flow, so -dH/dQ > 0).
  const head = pumpHead(d.spec, q, d.speedRatio);
  const slope = pumpHeadSlope(d.spec, q, d.speedRatio);
  const g = -head;
  const dgdQ = Math.max(-slope, MIN_SLOPE);
  return { g, dgdQ };
}
