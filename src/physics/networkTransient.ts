/**
 * Network transient (water hammer) solver — the Method of Characteristics on an
 * arbitrary branched network, so a user-built plant can be analyzed in the time
 * domain, not just the single reservoir→pipe→valve lab.
 *
 * Structure per time step:
 *   1. Every pipe advances its interior sections by the standard C+/C- MOC.
 *   2. Each pipe end contributes a characteristic (CP downstream, CM upstream)
 *      that is linear in the boundary node head.
 *   3. All unknown node heads are solved simultaneously by Newton's method:
 *      pipes contribute linear terms, valves and pumps nonlinear ones
 *      (orifice / pump-curve flow), so junctions, tees, valves and pumps are all
 *      handled uniformly.
 *   4. Pipe boundary sections are set from the solved node heads.
 *
 * A single common time step is used everywhere; each pipe's wave speed is nudged
 * (Courant adjustment) so it holds an integer number of reaches at that Δt.
 *
 * The initial condition is the steady-state solution, so holding all controls
 * constant reproduces steady flow, and closing a valve launches the surge.
 */

import { G } from '../domain/units';
import { FluidState, waterProperties } from '../domain/fluid';
import { PipelineNetwork, hasCheckValve } from '../domain/network';
import { pipeGeometry, A106B } from '../domain/catalog/pipes';
import { valveK } from '../domain/catalog/valves';
import { bepEfficiency } from '../domain/catalog/pumps';
import { fittingK } from '../domain/catalog/fittings';
import { reynolds, churchillFriction } from './friction';
import { waveSpeed } from './waveSpeed';
import { linkLength } from '../domain/network';
import { solveSteadyState } from './steadySolver';
import { solveLinearSystem } from './linalg';

interface TPipe {
  id: string;
  from: number;
  to: number;
  N: number;
  B: number;
  R: number;
  area: number;
  H: Float64Array; // N+1 heads
  Q: Float64Array; // N+1 flows
  cpEnd: number; // C+ constant at the downstream end (recomputed each step)
  cmEnd: number; // C- constant at the upstream end
}

interface TValve {
  id: string;
  from: number;
  to: number;
  area: number;
  nps: Parameters<typeof valveK>[1];
  schedule: Parameters<typeof valveK>[2];
  valveType: Parameters<typeof valveK>[0];
  opening: number;
}

interface TPump {
  id: string;
  from: number;
  to: number;
  /** Fixed head gain [m] while the motor runs (stiff-link approximation). */
  gain: number;
  /** Stiff conductance enforcing the head gain [m^3/s per m]. */
  C: number;
  // Rated curve H = a0 - a1 Q - a2 Q^2, used once the pump is tripped.
  a0: number;
  a1: number;
  a2: number;
  /** Speed ratio alpha = N / N_rated (1 while running; decays after a trip). */
  alpha: number;
  tripped: boolean;
  inertia: number; // rotor polar moment [kg m^2]
  omegaR: number; // rated angular speed [rad/s]
  etaR: number; // rated hydraulic efficiency
  qLast: number; // last solved pump flow [m^3/s] (for the rotor update)
  /** Discharge check valve fitted — blocks reverse flow (see solveNodes). */
  checkValve: boolean;
}

export interface NetworkTransientResult {
  dt: number;
  nodeIds: string[];
  pipeIds: string[];
}

const MIN_DH = 1e-4; // guards the sqrt derivative in the valve/pump laws

export class NetworkTransientSim {
  readonly dt: number;
  readonly nodeCount: number;
  /** Head at each node [m]. */
  nodeHead: Float64Array;
  time = 0;

  readonly nodeIds: string[];
  readonly pipeIds: string[];

  private readonly fluid: FluidState;
  private readonly isFixed: boolean[];
  private readonly demand: number[];
  private readonly pipes: TPipe[];
  private readonly valves: TValve[];
  private readonly pumps: TPump[];
  private nodeStorage: number[] = []; // per-node compliance [m^2] (0 = none)
  private readonly vaporGauge: number; // gauge vapor head [m] (~ -10 m)
  private readonly nodeElev: number[]; // node elevations [m]
  private hPrev: Float64Array; // node heads at the start of the step
  private readonly unknownIndex: number[]; // node -> unknown slot (-1 if fixed)
  private readonly nUnknown: number;

  constructor(net: PipelineNetwork, targetReaches = 4, minDt = 0) {
    this.fluid = waterProperties(net.temperatureC);
    const steady = solveSteadyState(net);

    this.nodeCount = net.nodes.length;
    this.nodeIds = net.nodes.map((n) => n.id);
    const nodeIndex = new Map<string, number>();
    net.nodes.forEach((n, i) => nodeIndex.set(n.id, i));

    this.isFixed = net.nodes.map((n) => n.type === 'reservoir');
    this.demand = net.nodes.map((n) => n.demand ?? 0);
    this.nodeHead = new Float64Array(net.nodes.map((n) => steady.heads.get(n.id) ?? n.position.y));
    this.hPrev = Float64Array.from(this.nodeHead);
    // Gauge vapor head (~ -10 m); the per-node cavitation floor is elevation +
    // this, since total head minus elevation is the gauge pressure head.
    this.vaporGauge = (this.fluid.pv - 101_325) / (this.fluid.rho * G);
    this.nodeElev = net.nodes.map((n) => n.position.y);

    this.unknownIndex = new Array(this.nodeCount).fill(-1);
    let u = 0;
    for (let i = 0; i < this.nodeCount; i++) if (!this.isFixed[i]) this.unknownIndex[i] = u++;
    this.nUnknown = u;

    // --- Compile pipes and pick the common time step -------------------
    const pipeLinks = net.links.filter((l) => l.kind === 'pipe');
    const pipeData = pipeLinks.map((l) => {
      const geo = pipeGeometry(l.nps, l.schedule);
      const L = linkLength(net, l);
      const q0 = steady.links.get(l.id)?.flow ?? 0;
      const a = waveSpeed(this.fluid.bulk, this.fluid.rho, geo.id, geo.wall, A106B.E);
      return { link: l, geo, L, q0, a };
    });

    // Common dt: the shortest travel time gives `targetReaches` reaches, but
    // floored by minDt so a very short pipe cannot explode the step count (it
    // then holds <1 reach with a small wave-speed deviation — fine for viz).
    const minTravel = Math.min(...pipeData.map((p) => p.L / p.a), Infinity);
    const rawDt = Number.isFinite(minTravel) && minTravel > 0 ? minTravel / targetReaches : 0.01;
    const dt = Math.max(rawDt, minDt);
    this.dt = dt;

    this.pipes = pipeData.map(({ link, geo, L, q0, a }) => {
      const N = Math.max(1, Math.min(400, Math.round(L / (a * dt))));
      const aAdj = L / (N * dt); // Courant-adjusted wave speed
      const dx = L / N;
      const re = reynolds(q0, geo.id, this.fluid.rho, this.fluid.mu);
      const f = churchillFriction(re, A106B.roughness / geo.id);
      const minorK = (link.fittings ?? []).reduce((s, ft) => s + fittingK(ft, link.nps), 0);
      const B = aAdj / (G * geo.area);
      // Friction per reach + lumped minor loss spread over the reaches.
      const R = ((f * dx) / (geo.id * 2 * G * geo.area * geo.area)) + minorK / (N * 2 * G * geo.area * geo.area);

      const from = nodeIndex.get(link.from)!;
      const to = nodeIndex.get(link.to)!;
      const H = new Float64Array(N + 1);
      const Q = new Float64Array(N + 1);
      const hFrom = steady.heads.get(link.from) ?? 0;
      const hTo = steady.heads.get(link.to) ?? 0;
      for (let i = 0; i <= N; i++) {
        H[i] = hFrom + (hTo - hFrom) * (i / N);
        Q[i] = q0;
      }
      return { id: link.id, from, to, N, B, R, area: geo.area, H, Q, cpEnd: 0, cmEnd: 0 };
    });

    this.valves = net.links
      .filter((l) => l.kind === 'valve')
      .map((l) => {
        if (l.kind !== 'valve') throw new Error('unreachable');
        return {
          id: l.id,
          from: nodeIndex.get(l.from)!,
          to: nodeIndex.get(l.to)!,
          area: pipeGeometry(l.nps, l.schedule).area,
          nps: l.nps,
          schedule: l.schedule,
          valveType: l.valveType,
          opening: l.opening,
        };
      });

    // Reference conductance from the pipes, used to scale the stiff pump link
    // and the massless-node compliance so the solve stays well-conditioned.
    const refCond = Math.max(...this.pipes.map((p) => 1 / p.B), 1e-4);
    this.pumps = net.links
      .filter((l) => l.kind === 'pump')
      .map((l) => {
        if (l.kind !== 'pump') throw new Error('unreachable');
        const from = nodeIndex.get(l.from)!;
        const to = nodeIndex.get(l.to)!;
        const gain = (steady.heads.get(l.to) ?? 0) - (steady.heads.get(l.from) ?? 0);
        const s = l.spec;
        return {
          id: l.id,
          from,
          to,
          gain,
          C: 200 * refCond,
          a0: s.a0,
          a1: s.a1,
          a2: s.a2,
          alpha: 1,
          tripped: false,
          inertia: s.inertia,
          omegaR: (s.ratedRpm * 2 * Math.PI) / 60,
          etaR: bepEfficiency(s),
          qLast: steady.links.get(l.id)?.flow ?? 0,
          checkValve: hasCheckValve(l),
        };
      });

    // Nodes with no attached pipe (e.g. between a valve and a pump) get a small
    // compliance so they stay non-singular when a valve shuts.
    const hasPipe = new Array(this.nodeCount).fill(false);
    for (const p of this.pipes) { hasPipe[p.from] = true; hasPipe[p.to] = true; }
    this.nodeStorage = net.nodes.map((_, i) => (hasPipe[i] || this.isFixed[i] ? 0 : 0.02));

    this.pipeIds = this.pipes.map((p) => p.id);
  }

  /** Set a valve's opening (0..1). Used to drive a closure scenario. */
  setValveOpening(valveId: string, opening: number): void {
    const v = this.valves.find((x) => x.id === valveId);
    if (v) v.opening = Math.max(0, Math.min(1, opening));
  }

  /** Trip a pump (power failure): the motor torque vanishes and the rotor
   *  spins down under fluid torque from here on. */
  tripPump(pumpId: string): void {
    const p = this.pumps.find((x) => x.id === pumpId);
    if (p) p.tripped = true;
  }

  /** Pump speed ratio N/N_rated (1 = rated, 0 = stopped). */
  pumpSpeed(pumpId: string): number {
    const p = this.pumps.find((x) => x.id === pumpId);
    return p ? p.alpha : 0;
  }

  /** Ids of pumps (for the UI to offer a trip target). */
  get pumpList(): string[] {
    return this.pumps.map((p) => p.id);
  }

  /** Head [m] at a node by id. */
  headOf(nodeId: string): number {
    const i = this.nodeIds.indexOf(nodeId);
    return i >= 0 ? this.nodeHead[i] : NaN;
  }

  /** Head at a pipe's midpoint [m] (for visualization). */
  pipeMidHead(pipeId: string): number {
    const p = this.pipes.find((x) => x.id === pipeId);
    if (!p) return 0;
    return p.H[Math.floor(p.N / 2)];
  }

  /** Flow through a pipe [m^3/s] (downstream end). */
  pipeFlow(pipeId: string): number {
    const p = this.pipes.find((x) => x.id === pipeId);
    return p ? p.Q[p.N] : 0;
  }

  private valveConductance(v: TValve): number {
    const k = valveK(v.valveType, v.nps, v.schedule, v.opening);
    if (!Number.isFinite(k) || k <= 0) return 0;
    return v.area * Math.sqrt((2 * G) / k);
  }

  /** Advance one time step. */
  step(): void {
    const { pipes } = this;

    // 1) Characteristic constants + interior advance for every pipe.
    const nextH: Float64Array[] = [];
    const nextQ: Float64Array[] = [];
    for (const p of pipes) {
      const { N, B, R, H, Q } = p;
      p.cpEnd = H[N - 1] + B * Q[N - 1] - R * Q[N - 1] * Math.abs(Q[N - 1]);
      p.cmEnd = H[1] - B * Q[1] + R * Q[1] * Math.abs(Q[1]);
      const Hn = new Float64Array(N + 1);
      const Qn = new Float64Array(N + 1);
      for (let i = 1; i < N; i++) {
        const cp = H[i - 1] + B * Q[i - 1] - R * Q[i - 1] * Math.abs(Q[i - 1]);
        const cm = H[i + 1] - B * Q[i + 1] + R * Q[i + 1] * Math.abs(Q[i + 1]);
        Hn[i] = 0.5 * (cp + cm);
        Qn[i] = (cp - cm) / (2 * B);
      }
      nextH.push(Hn);
      nextQ.push(Qn);
    }

    // 2) Solve node heads (Newton). Pipes are linear; valves nonlinear.
    this.hPrev.set(this.nodeHead);
    this.solveNodes();

    // 2b) Cavitation floor: liquid cannot sustain large tension, so clamp node
    // heads at the vapor level (a simple column-separation limiter — full DVCM
    // per node is future work). This also keeps the solve well-behaved.
    for (let i = 0; i < this.nodeCount; i++) {
      const floor = this.nodeElev[i] + this.vaporGauge;
      if (this.unknownIndex[i] >= 0 && this.nodeHead[i] < floor) {
        this.nodeHead[i] = floor;
      }
    }

    // 3) Set each pipe's boundary sections from the solved node heads.
    for (let pi = 0; pi < pipes.length; pi++) {
      const p = pipes[pi];
      const Hn = nextH[pi];
      const Qn = nextQ[pi];
      const hFrom = this.nodeHead[p.from];
      const hTo = this.nodeHead[p.to];
      Hn[0] = hFrom;
      Qn[0] = (hFrom - p.cmEnd) / p.B;
      Hn[p.N] = hTo;
      Qn[p.N] = (p.cpEnd - hTo) / p.B;
      p.H = Hn;
      p.Q = Qn;
    }

    // 4) Rotor dynamics for tripped pumps: I dω/dt = -T_fluid. With no motor
    // torque, the fluid torque T = ρ g Q H / (η ω) decelerates the rotor, so a
    // heavier rotor (more inertia) sustains flow longer and softens the surge.
    for (const p of this.pumps) {
      if (!p.tripped) continue;
      const q = Math.max(0, p.qLast);
      const hPump = Math.max(0, this.nodeHead[p.to] - this.nodeHead[p.from]);
      const omega = Math.max(p.alpha * p.omegaR, 0.02 * p.omegaR);
      const torque = (this.fluid.rho * G * q * hPump) / (p.etaR * omega);
      const dAlpha = -(torque * this.dt) / (p.inertia * p.omegaR);
      p.alpha = Math.max(0, p.alpha + dAlpha);
    }

    this.time += this.dt;
  }

  /** Newton solve for the unknown node heads at the new time level. */
  private solveNodes(): void {
    const n = this.nUnknown;
    if (n === 0) return;
    const H = this.nodeHead;

    for (let iter = 0; iter < 8; iter++) {
      const F = new Array<number>(n).fill(0);
      const J: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));

      // Demand: continuity residual is (sum inflow) - demand = 0.
      for (let i = 0; i < this.nodeCount; i++) {
        const ui = this.unknownIndex[i];
        if (ui >= 0) F[ui] -= this.demand[i];
      }

      // Pipe contributions (linear): inflow to a boundary node = (C - H)/B.
      for (const p of this.pipes) {
        const uf = this.unknownIndex[p.from];
        const ut = this.unknownIndex[p.to];
        if (uf >= 0) {
          // upstream node: inflow = (cmEnd - H_from)/B
          F[uf] += (p.cmEnd - H[p.from]) / p.B;
          J[uf][uf] += -1 / p.B;
        }
        if (ut >= 0) {
          // downstream node: inflow = (cpEnd - H_to)/B
          F[ut] += (p.cpEnd - H[p.to]) / p.B;
          J[ut][ut] += -1 / p.B;
        }
      }

      // Valve contributions (nonlinear orifice): Q = Gv * sign(dH) sqrt(|dH|).
      for (const v of this.valves) {
        const Gv = this.valveConductance(v);
        const dH = H[v.from] - H[v.to];
        const adH = Math.max(Math.abs(dH), MIN_DH);
        const q = Gv * Math.sign(dH) * Math.sqrt(adH);
        const dq = Gv / (2 * Math.sqrt(adH)); // dQ/d(dH)
        const uf = this.unknownIndex[v.from];
        const ut = this.unknownIndex[v.to];
        // from node loses q, to node gains q.
        if (uf >= 0) { F[uf] -= q; J[uf][uf] += -dq; if (ut >= 0) J[uf][ut] += dq; }
        if (ut >= 0) { F[ut] += q; J[ut][ut] += -dq; if (uf >= 0) J[ut][uf] += dq; }
      }

      // Pump contributions. A running pump is a stiff head-gain link (stable).
      // A tripped pump uses its affinity-scaled curve at the current speed with
      // a discharge check valve (no reverse flow) — the spin-down / check-valve
      // slam that drives power-failure water hammer.
      for (const p of this.pumps) {
        const uf = this.unknownIndex[p.from];
        const ut = this.unknownIndex[p.to];
        if (!p.tripped) {
          // Stiff head-gain link. Once the check valve shuts (the surge has
          // pushed the discharge above what the pump can hold), the same link
          // becomes near-non-conducting instead of passing flow backwards —
          // the check-valve slam that a running pump also sees during a surge.
          const drive = H[p.from] + p.gain - H[p.to];
          const shut = p.checkValve && drive < 0;
          const C = shut ? p.C * 1e-6 : p.C;
          const q = C * drive;
          if (uf >= 0) { F[uf] -= q; J[uf][uf] += -C; if (ut >= 0) J[uf][ut] += C; }
          if (ut >= 0) { F[ut] += q; J[ut][ut] += -C; if (uf >= 0) J[ut][uf] += C; }
          p.qLast = q;
          continue;
        }
        // Tripped: solve H_to - H_from = a0 α² - a1 α Q - a2 Q²  for Q >= 0.
        // Q is clamped non-negative below, which is the check valve; a tripped
        // pump without one would need a four-quadrant curve (out of scope).
        const a = p.alpha;
        const dHba = H[p.to] - H[p.from];
        const disc = (p.a1 * a) ** 2 - 4 * p.a2 * (dHba - p.a0 * a * a);
        let q = 0;
        let dq = 0; // dQ/d(dHba)
        if (disc > 0 && p.a2 > 1e-9) {
          const qs = (-p.a1 * a + Math.sqrt(disc)) / (2 * p.a2);
          if (qs > 0) {
            q = qs;
            const denom = 2 * p.a2 * qs + p.a1 * a;
            dq = Math.abs(denom) > 1e-9 ? -1 / denom : 0;
          }
        }
        p.qLast = q;
        if (uf >= 0) { F[uf] -= q; J[uf][uf] += -dq * -1; if (ut >= 0) J[uf][ut] += -dq * 1; }
        if (ut >= 0) { F[ut] += q; J[ut][ut] += dq * 1; if (uf >= 0) J[ut][uf] += dq * -1; }
      }

      // Nodal compliance (regularizes massless internal nodes): a small storage
      // A * dH/dt = net inflow, i.e. residual term -A/dt * (H - H_prev).
      for (let i = 0; i < this.nodeCount; i++) {
        const ui = this.unknownIndex[i];
        const A = this.nodeStorage[i];
        if (ui >= 0 && A > 0) {
          F[ui] -= (A / this.dt) * (H[i] - this.hPrev[i]);
          J[ui][ui] += -A / this.dt;
        }
      }

      // Solve J * dH = -F and update.
      const rhs = F.map((f) => -f);
      let dH: number[];
      try {
        dH = solveLinearSystem(J, rhs);
      } catch {
        break; // singular (e.g. isolated node); keep current heads
      }
      let maxStep = 0;
      for (let i = 0; i < this.nodeCount; i++) {
        const ui = this.unknownIndex[i];
        if (ui >= 0) {
          H[i] += dH[ui];
          maxStep = Math.max(maxStep, Math.abs(dH[ui]));
        }
      }
      if (maxStep < 1e-7) break;
    }
  }
}
