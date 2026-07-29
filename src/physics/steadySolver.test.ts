import { describe, it, expect } from 'vitest';
import { G } from '../domain/units';
import { waterProperties } from '../domain/fluid';
import { pipeGeometry, NominalSize, Schedule } from '../domain/catalog/pipes';
import { PUMP_50M } from '../domain/catalog/pumps';
import { PipelineNetwork } from '../domain/network';
import { churchillFriction, reynolds } from './friction';
import { solveSteadyState } from './steadySolver';

// --- Independent reference model (no matrix assembly) --------------------
// A completely separate code path used to cross-check the GGA solver: it
// computes pipe head loss directly from Darcy-Weisbach + Churchill and finds
// flows by scalar bisection. If the matrix solver agrees with this, the
// assembly is correct.

function pipeHeadLoss(q: number, nps: NominalSize, sched: Schedule, length: number, tempC: number): number {
  const geo = pipeGeometry(nps, sched);
  const fluid = waterProperties(tempC);
  const re = reynolds(q, geo.id, fluid.rho, fluid.mu);
  const f = churchillFriction(re, 0.045e-3 / geo.id);
  const r = (f * length) / (geo.id * 2 * G * geo.area * geo.area);
  return r * q * Math.abs(q);
}

/** Solve pipeHeadLoss(Q) = target for Q >= 0 by bisection. */
function flowForHeadLoss(target: number, nps: NominalSize, sched: Schedule, length: number, tempC: number): number {
  let lo = 0;
  let hi = 10; // 10 m^3/s is far beyond any case here
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    const hl = pipeHeadLoss(mid, nps, sched, length, tempC);
    if (hl < target) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

describe('GGA steady-state solver — single pipe between two reservoirs', () => {
  const net: PipelineNetwork = {
    temperatureC: 20,
    subAssemblies: [],
    nodes: [
      { id: 'A', type: 'reservoir', position: { x: 0, y: 100, z: 0 }, fixedHead: 100 },
      { id: 'B', type: 'reservoir', position: { x: 1000, y: 80, z: 0 }, fixedHead: 80 },
    ],
    links: [{ id: 'P1', kind: 'pipe', from: 'A', to: 'B', nps: '6"', schedule: '40', length: 1000 }],
  };

  it('converges and satisfies the energy equation to tight tolerance', () => {
    const res = solveSteadyState(net);
    expect(res.converged).toBe(true);
    const p1 = res.links.get('P1')!;
    // Head loss across the pipe must equal the 20 m reservoir difference.
    expect(p1.headLoss).toBeCloseTo(20, 6);
  });

  it('flow matches the independent Darcy-Weisbach reference', () => {
    const res = solveSteadyState(net);
    const qRef = flowForHeadLoss(20, '6"', '40', 1000, 20);
    const q = res.links.get('P1')!.flow;
    expect(q).toBeGreaterThan(0); // A (100) -> B (80)
    expect(q).toBeCloseTo(qRef, 5);
  });
});

describe('GGA steady-state solver — three-reservoir problem', () => {
  // Classic branched network: three reservoirs feeding a common junction J.
  const net: PipelineNetwork = {
    temperatureC: 20,
    subAssemblies: [],
    nodes: [
      { id: 'R1', type: 'reservoir', position: { x: 0, y: 100, z: 0 }, fixedHead: 100 },
      { id: 'R2', type: 'reservoir', position: { x: 0, y: 80, z: 0 }, fixedHead: 80 },
      { id: 'R3', type: 'reservoir', position: { x: 0, y: 60, z: 0 }, fixedHead: 60 },
      { id: 'J', type: 'junction', position: { x: 500, y: 50, z: 0 }, demand: 0 },
    ],
    links: [
      { id: 'P1', kind: 'pipe', from: 'R1', to: 'J', nps: '8"', schedule: '40', length: 1200 },
      { id: 'P2', kind: 'pipe', from: 'R2', to: 'J', nps: '6"', schedule: '40', length: 900 },
      { id: 'P3', kind: 'pipe', from: 'R3', to: 'J', nps: '6"', schedule: '40', length: 1500 },
    ],
  };

  it('converges with mass balance and energy satisfied at the junction', () => {
    const res = solveSteadyState(net);
    expect(res.converged).toBe(true);

    const q1 = res.links.get('P1')!.flow;
    const q2 = res.links.get('P2')!.flow;
    const q3 = res.links.get('P3')!.flow;

    // Continuity at J (demand 0): net inflow must vanish.
    expect(q1 + q2 + q3).toBeCloseTo(0, 6);

    // Junction head lies between the lowest and highest reservoir.
    const hJ = res.heads.get('J')!;
    expect(hJ).toBeGreaterThan(60);
    expect(hJ).toBeLessThan(100);
  });

  it('agrees with the independent scalar three-reservoir solution', () => {
    const res = solveSteadyState(net);
    const hJsolver = res.heads.get('J')!;

    // Independent reference: bisect on H_J until net flow into J is zero.
    const reservoirs: Array<{ z: number; nps: NominalSize; L: number }> = [
      { z: 100, nps: '8"', L: 1200 },
      { z: 80, nps: '6"', L: 900 },
      { z: 60, nps: '6"', L: 1500 },
    ];
    const netInflow = (hJ: number): number =>
      reservoirs.reduce((sum, r) => {
        const drive = r.z - hJ;
        const q = flowForHeadLoss(Math.abs(drive), r.nps, '40', r.L, 20);
        return sum + Math.sign(drive) * q;
      }, 0);

    let lo = 60;
    let hi = 100;
    for (let i = 0; i < 200; i++) {
      const mid = 0.5 * (lo + hi);
      // netInflow decreases as H_J rises.
      if (netInflow(mid) > 0) lo = mid;
      else hi = mid;
    }
    const hJref = 0.5 * (lo + hi);

    expect(hJsolver).toBeCloseTo(hJref, 3);
  });
});

describe('GGA steady-state solver — pump lifting between reservoirs', () => {
  // Low reservoir -> pump -> pipe -> high reservoir. The duty point is where
  // the pump head equals the static lift plus friction.
  const net: PipelineNetwork = {
    temperatureC: 20,
    subAssemblies: [],
    nodes: [
      { id: 'LOW', type: 'reservoir', position: { x: 0, y: 5, z: 0 }, fixedHead: 5 },
      { id: 'J', type: 'junction', position: { x: 1, y: 5, z: 0 }, demand: 0 },
      { id: 'HIGH', type: 'reservoir', position: { x: 300, y: 30, z: 0 }, fixedHead: 30 },
    ],
    links: [
      { id: 'PUMP', kind: 'pump', from: 'LOW', to: 'J', spec: PUMP_50M, speedRatio: 1 },
      { id: 'DISCHARGE', kind: 'pipe', from: 'J', to: 'HIGH', nps: '4"', schedule: '40', length: 300 },
    ],
  };

  it('finds the pump/system duty point matching an independent scalar solve', () => {
    const res = solveSteadyState(net);
    expect(res.converged).toBe(true);
    const q = res.links.get('DISCHARGE')!.flow;
    expect(q).toBeGreaterThan(0);

    // Independent reference: solve pumpHead(Q) = staticLift + pipeHeadLoss(Q).
    const staticLift = 30 - 5;
    const residual = (qTest: number): number => {
      const hPump = PUMP_50M.a0 - PUMP_50M.a1 * qTest - PUMP_50M.a2 * qTest * qTest;
      return hPump - (staticLift + pipeHeadLoss(qTest, '4"', '40', 300, 20));
    };
    let lo = 0;
    let hi = 160 / 3600; // beyond runout
    for (let i = 0; i < 200; i++) {
      const mid = 0.5 * (lo + hi);
      // residual decreases as Q rises (pump head falls, losses rise).
      if (residual(mid) > 0) lo = mid;
      else hi = mid;
    }
    const qRef = 0.5 * (lo + hi);

    expect(q).toBeCloseTo(qRef, 4);
  });
});

describe('GGA steady-state solver — valve throttling', () => {
  function buildWithOpening(opening: number): PipelineNetwork {
    return {
      temperatureC: 20,
      subAssemblies: [],
      nodes: [
        { id: 'A', type: 'reservoir', position: { x: 0, y: 50, z: 0 }, fixedHead: 50 },
        { id: 'J', type: 'junction', position: { x: 10, y: 20, z: 0 }, demand: 0 },
        { id: 'B', type: 'reservoir', position: { x: 100, y: 20, z: 0 }, fixedHead: 20 },
      ],
      links: [
        { id: 'V', kind: 'valve', from: 'A', to: 'J', valveType: 'globe', nps: '4"', schedule: '40', opening },
        { id: 'P', kind: 'pipe', from: 'J', to: 'B', nps: '4"', schedule: '40', length: 100 },
      ],
    };
  }

  it('throttling the valve reduces the flow', () => {
    const open = solveSteadyState(buildWithOpening(1.0));
    const half = solveSteadyState(buildWithOpening(0.5));
    const nearlyShut = solveSteadyState(buildWithOpening(0.15));

    const qOpen = open.links.get('P')!.flow;
    const qHalf = half.links.get('P')!.flow;
    const qShut = nearlyShut.links.get('P')!.flow;

    expect(qOpen).toBeGreaterThan(qHalf);
    expect(qHalf).toBeGreaterThan(qShut);
    expect(qShut).toBeGreaterThan(0);
  });
});

describe('GGA steady-state solver — a stopped pump blocks flow instead of bypassing it', () => {
  // Two reservoirs at the SAME head (no natural driving force at all) joined
  // through a pump. With the pump off, this must settle to ~zero flow rather
  // than behaving like a free, resistance-less connector.
  function buildWithSpeed(speedRatio: number): PipelineNetwork {
    return {
      temperatureC: 20,
      subAssemblies: [],
      nodes: [
        { id: 'A', type: 'reservoir', position: { x: 0, y: 10, z: 0 }, fixedHead: 10 },
        { id: 'J', type: 'junction', position: { x: 1, y: 10, z: 0 }, demand: 0 },
        { id: 'B', type: 'reservoir', position: { x: 100, y: 10, z: 0 }, fixedHead: 10 },
      ],
      links: [
        { id: 'PUMP', kind: 'pump', from: 'A', to: 'J', spec: PUMP_50M, speedRatio },
        { id: 'P', kind: 'pipe', from: 'J', to: 'B', nps: '4"', schedule: '40', length: 100 },
      ],
    };
  }

  it('stopped pump (speedRatio 0) yields negligible flow', () => {
    const res = solveSteadyState(buildWithSpeed(0));
    expect(res.converged).toBe(true);
    expect(Math.abs(res.links.get('P')!.flow)).toBeLessThan(1e-6);
  });

  it('running the pump (speedRatio 1) drives real flow with equal reservoir heads', () => {
    const res = solveSteadyState(buildWithSpeed(1));
    expect(res.converged).toBe(true);
    expect(res.links.get('P')!.flow).toBeGreaterThan(1e-3);
  });
});
