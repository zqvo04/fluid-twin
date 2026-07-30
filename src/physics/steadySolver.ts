/**
 * Steady-state hydraulic solver — Global Gradient Algorithm (Todini & Pilati,
 * 1988), the method behind EPANET.
 *
 * The network is a system of nonlinear equations:
 *     energy:      g_p(Q_p) = H_from - H_to      for every link p
 *     continuity:  sum_p A[p,n] Q_p = demand_n    for every junction n
 * where g_p is the link's head loss (friction + minor losses, or minus pump
 * head). We solve it with Newton's method. Eliminating the flow correction
 * gives a symmetric positive-definite system in the head corrections
 *     (A21 D^-1 A12) dH = F2 - A21 D^-1 F1
 * which is a weighted graph Laplacian, solved directly.
 *
 * Fixed-head nodes (reservoirs) are excluded from the unknowns and anchor the
 * head field. Elevation enters through each node's Y-coordinate.
 */

import { FluidState, waterProperties } from '../domain/fluid';
import { PipelineNetwork, NetworkNode } from '../domain/network';
import { CompiledLink, compileLink, evaluateLink } from './resistance';
import { solveLinearSystem } from './linalg';

export interface LinkResult {
  id: string;
  /** Flow [m^3/s], positive in the from->to direction. */
  flow: number;
  /** Bulk velocity [m/s]. NaN for pumps (no single bore). */
  velocity: number;
  /** Head loss H_from - H_to [m] (negative across a pump = head gain). */
  headLoss: number;
}

export interface SteadyResult {
  converged: boolean;
  iterations: number;
  /** Final max flow correction, used as the convergence measure. */
  residual: number;
  /** Total head [m] at every node, keyed by node id. */
  heads: Map<string, number>;
  /** Per-link results, keyed by link id. */
  links: Map<string, LinkResult>;
  fluid: FluidState;
}

export interface SolverOptions {
  maxIterations?: number;
  /** Convergence tolerance on the max flow correction [m^3/s]. */
  tolerance?: number;
  /** Under-relaxation factor applied to each Newton step (0..1]. */
  relaxation?: number;
}

const DEFAULTS: Required<SolverOptions> = {
  maxIterations: 100,
  tolerance: 1e-8,
  relaxation: 1.0,
};

function resolvedFixedHead(node: NetworkNode): number {
  // Reservoir head defaults to its free-surface elevation (Y) if not overridden.
  return node.fixedHead ?? node.position.y;
}

export function solveSteadyState(net: PipelineNetwork, options: SolverOptions = {}): SteadyResult {
  const opts = { ...DEFAULTS, ...options };
  const fluid = waterProperties(net.temperatureC);

  const nodes = net.nodes;
  const nNodes = nodes.length;

  // Global node index and unknown (junction) sub-index.
  const nodeIndex = new Map<string, number>();
  nodes.forEach((n, i) => nodeIndex.set(n.id, i));

  const head = new Array<number>(nNodes).fill(0);
  const isFixed = new Array<boolean>(nNodes).fill(false);
  const unknownIndex = new Array<number>(nNodes).fill(-1);
  let nUnknown = 0;

  const fixedHeadValues: number[] = [];
  for (let i = 0; i < nNodes; i++) {
    if (nodes[i].type === 'reservoir') {
      isFixed[i] = true;
      head[i] = resolvedFixedHead(nodes[i]);
      fixedHeadValues.push(head[i]);
    } else {
      unknownIndex[i] = nUnknown++;
    }
  }

  // Initialize unknown heads to the mean fixed head (a neutral starting field).
  const meanFixed = fixedHeadValues.length
    ? fixedHeadValues.reduce((a, b) => a + b, 0) / fixedHeadValues.length
    : 0;
  for (let i = 0; i < nNodes; i++) {
    if (!isFixed[i]) head[i] = meanFixed;
  }

  // Compile links and seed a nonzero flow so the Jacobian starts well-scaled.
  const compiled: CompiledLink[] = net.links.map((l) => compileLink(net, l, nodeIndex));
  const flow = new Array<number>(compiled.length).fill(0.01);

  const demand = new Array<number>(nNodes).fill(0);
  for (let i = 0; i < nNodes; i++) demand[i] = nodes[i].demand ?? 0;

  let residual = Infinity;
  let iter = 0;
  let converged = false;

  for (iter = 1; iter <= opts.maxIterations; iter++) {
    // Assemble the Schur system M dH = rhs over the unknown nodes.
    const M: number[][] = Array.from({ length: nUnknown }, () => new Array<number>(nUnknown).fill(0));
    const rhs = new Array<number>(nUnknown).fill(0);

    // Continuity residual F2[a] = (A21 Q)_a - demand_a, seeded with -demand.
    const F2 = new Array<number>(nUnknown).fill(0);
    for (let i = 0; i < nNodes; i++) {
      const a = unknownIndex[i];
      if (a >= 0) F2[a] = -demand[i];
    }

    // Per-link contributions.
    const F1 = new Array<number>(compiled.length).fill(0);
    const w = new Array<number>(compiled.length).fill(0);
    // Largest still-moving internal link state (a pump's relaxed NPSHa).
    let maxState = 0;

    for (let p = 0; p < compiled.length; p++) {
      const link = compiled[p];
      const q = flow[p];
      // The link's own `from` head is fed back in: a pump's deliverable head
      // depends on the suction pressure it sees, so that coupling is closed
      // inside the Newton loop (evaluateLink relaxes it for stability).
      const { g, dgdQ, stateResidual } = evaluateLink(link, q, fluid, head[link.fromIndex]);
      const wp = 1 / dgdQ;
      w[p] = wp;
      if (stateResidual > maxState) maxState = stateResidual;

      const i = link.fromIndex;
      const j = link.toIndex;

      // F1_p = g + H_to - H_from (current heads).
      F1[p] = g + head[j] - head[i];

      // Continuity accumulation: A[p,from] = -1, A[p,to] = +1.
      const ua = unknownIndex[i];
      const ub = unknownIndex[j];
      if (ua >= 0) F2[ua] += -q;
      if (ub >= 0) F2[ub] += q;

      // Laplacian assembly for M = A21 D^-1 A12.
      if (ua >= 0) M[ua][ua] += wp;
      if (ub >= 0) M[ub][ub] += wp;
      if (ua >= 0 && ub >= 0) {
        M[ua][ub] -= wp;
        M[ub][ua] -= wp;
      }
    }

    // rhs[a] = F2[a] - sum_p A[p,a] * w_p * F1_p.
    for (let a = 0; a < nUnknown; a++) rhs[a] = F2[a];
    for (let p = 0; p < compiled.length; p++) {
      const ua = unknownIndex[compiled[p].fromIndex];
      const ub = unknownIndex[compiled[p].toIndex];
      const contribution = w[p] * F1[p];
      if (ua >= 0) rhs[ua] -= -contribution; // A[p,from] = -1
      if (ub >= 0) rhs[ub] -= contribution; // A[p,to]   = +1
    }

    const dH = nUnknown > 0 ? solveLinearSystem(M, rhs) : [];

    // Flow correction: dQ_p = -w_p (F1_p + (dH_to - dH_from)).
    let maxDq = 0;
    for (let p = 0; p < compiled.length; p++) {
      const ua = unknownIndex[compiled[p].fromIndex];
      const ub = unknownIndex[compiled[p].toIndex];
      const dHfrom = ua >= 0 ? dH[ua] : 0;
      const dHto = ub >= 0 ? dH[ub] : 0;
      const dQ = -w[p] * (F1[p] + (dHto - dHfrom));
      flow[p] += opts.relaxation * dQ;
      maxDq = Math.max(maxDq, Math.abs(dQ));
    }

    // Head update.
    for (let i = 0; i < nNodes; i++) {
      const a = unknownIndex[i];
      if (a >= 0) head[i] += opts.relaxation * dH[a];
    }

    residual = maxDq;
    // Both the flow correction and every link's own relaxed state have to
    // have settled — a pump's NPSHa feedback can still be drifting while the
    // Newton step alone has gone quiet.
    if (residual < opts.tolerance && maxState < opts.tolerance) {
      converged = true;
      break;
    }
  }

  // Assemble results.
  const heads = new Map<string, number>();
  nodes.forEach((n, i) => heads.set(n.id, head[i]));

  const links = new Map<string, LinkResult>();
  for (let p = 0; p < compiled.length; p++) {
    const link = compiled[p];
    const q = flow[p];
    const netLink = net.links[p];
    let velocity = NaN;
    if (netLink.kind === 'pipe' || netLink.kind === 'valve') {
      const d = link.data;
      const area = d.kind === 'pump' ? NaN : d.area;
      velocity = q / area;
    }
    const headLoss = head[link.fromIndex] - head[link.toIndex];
    links.set(link.id, { id: link.id, flow: q, velocity, headLoss });
  }

  return { converged, iterations: iter, residual, heads, links, fluid };
}
