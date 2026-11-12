import { describe, it, expect } from 'vitest';
import { NetworkTransientSim, surgeCheck, surgeCheckRecommended } from './networkTransient';
import { solveSteadyState } from './steadySolver';
import { PipelineNetwork } from '../domain/network';
import { PUMP_50M } from '../domain/catalog/pumps';
import { pipeGeometry, A106B } from '../domain/catalog/pipes';
import { waterProperties } from '../domain/fluid';
import { G } from '../domain/units';
import { waveSpeed } from './waveSpeed';

/** R1 (20 m) → 200 m → pump → 300 m → R2 (40 m), 6" Sch 40. */
function pumpLine(speedRatio: number): PipelineNetwork {
  const n = (id: string, x: number, type: 'reservoir' | 'junction', fixedHead?: number) => ({
    id,
    type,
    position: { x, y: 0, z: 0 },
    ...(type === 'reservoir' ? { fixedHead } : { demand: 0 }),
  });
  return {
    nodes: [n('R1', 0, 'reservoir', 20), n('J1', 200, 'junction'), n('J2', 201, 'junction'), n('R2', 501, 'reservoir', 40)],
    links: [
      { id: 'P1', kind: 'pipe', from: 'R1', to: 'J1', nps: '6"', schedule: '40', length: 200 },
      { id: 'PB', kind: 'pump', from: 'J1', to: 'J2', spec: PUMP_50M, speedRatio },
      { id: 'P2', kind: 'pipe', from: 'J2', to: 'R2', nps: '6"', schedule: '40', length: 300 },
    ],
    subAssemblies: [],
    temperatureC: 20,
  };
}

describe('V&V-8 MOC pump start-up', () => {
  it('a stopped pump holds zero flow until started', () => {
    const sim = new NetworkTransientSim(pumpLine(0));
    for (let i = 0; i < 200; i++) sim.step();
    // Only the blocked-pump leak of the initial steady state (≈ 0.016 L/s).
    expect(Math.abs(sim.pipeFlow('P2'))).toBeLessThan(1e-4);
    expect(sim.pumpSpeed('PB')).toBe(0);
  });

  it('ramps the speed and settles on the GGA steady solution (< 0.5 %)', () => {
    const sim = new NetworkTransientSim(pumpLine(0));
    sim.startPump('PB', 5);
    let tMid = false;
    while (sim.time < 120) {
      sim.step();
      if (!tMid && sim.time >= 2.5) {
        expect(sim.pumpSpeed('PB')).toBeCloseTo(0.5, 1);
        tMid = true;
      }
    }
    expect(sim.pumpSpeed('PB')).toBe(1);
    const steady = solveSteadyState(pumpLine(1));
    const qGGA = steady.links.get('P2')!.flow;
    expect(qGGA).toBeGreaterThan(0.02);
    expect(Math.abs(sim.pipeFlow('P2') / qGGA - 1)).toBeLessThan(0.005);
    expect(Math.abs(sim.pipeFlow('P1') / qGGA - 1)).toBeLessThan(0.005);
    for (const id of ['J1', 'J2']) {
      expect(Math.abs(sim.headOf(id) / steady.heads.get(id)! - 1)).toBeLessThan(0.005);
    }
  });

  it('a trip after a start hands the rotor back to its inertia', () => {
    const sim = new NetworkTransientSim(pumpLine(1));
    sim.startPump('PB', 1);
    for (let i = 0; i < 50; i++) sim.step();
    sim.tripPump('PB');
    for (let i = 0; i < 200; i++) sim.step();
    const s = sim.pumpSpeed('PB');
    expect(s).toBeLessThan(1);
    expect(s).toBeGreaterThan(0);
  });
});

describe('surgeCheck', () => {
  const valveLine = (): PipelineNetwork => ({
    nodes: [
      { id: 'R1', type: 'reservoir', position: { x: 0, y: 0, z: 0 }, fixedHead: 60 },
      { id: 'J', type: 'junction', position: { x: 500, y: 0, z: 0 }, demand: 0 },
      { id: 'R2', type: 'reservoir', position: { x: 501, y: 0, z: 0 }, fixedHead: 0 },
    ],
    links: [
      { id: 'P', kind: 'pipe', from: 'R1', to: 'J', nps: '6"', schedule: '40', length: 500 },
      { id: 'V', kind: 'valve', from: 'J', to: 'R2', valveType: 'gate', nps: '6"', schedule: '40', opening: 1 },
    ],
    subAssemblies: [],
    temperatureC: 20,
  });

  it('rapid valve closure surges by about the Joukowsky head a·V0/g, at the valve', () => {
    const net = valveLine();
    const fast = surgeCheck(net, { kind: 'valveStroke', t: 0, id: 'V', target: 0, timeS: 0.1 });
    const fluid = waterProperties(20);
    const geo = pipeGeometry('6"', '40');
    const a = waveSpeed(fluid.bulk, fluid.rho, geo.id, geo.wall, A106B.E);
    const v0 = solveSteadyState(net).links.get('P')!.flow / geo.area;
    const joukowsky = (a * v0) / G;
    expect(fast.peak.nodeId).toBe('J');
    // Line packing behind the front adds a little on top of a·V0/g.
    expect(fast.peak.rise / joukowsky).toBeGreaterThan(0.95);
    expect(fast.peak.rise / joukowsky).toBeLessThan(1.2);
    expect(fast.maxHead.J).toBe(fast.peak.head);
    expect(fast.minHead.R1).toBe(60); // reservoirs hold their head
  });

  it('T < 10·(2L/a) recommends a surge check', () => {
    // L = 500 m, a ≈ 1.3 km/s → 10·2L/a ≈ 7.6 s.
    const net = valveLine();
    expect(surgeCheckRecommended(net, { kind: 'valveStroke', t: 0, id: 'V', target: 0, timeS: 2 })).toBe(true);
    expect(surgeCheckRecommended(net, { kind: 'valveStroke', t: 0, id: 'V', target: 0, timeS: 30 })).toBe(false);
    expect(surgeCheckRecommended(net, { kind: 'pumpStop', t: 0, id: 'X' })).toBe(true);
  });

  it('pump start-up surge check runs from rest', () => {
    const r = surgeCheck(pumpLine(0), { kind: 'pumpStart', t: 0, id: 'PB', rampS: 2 });
    expect(r.peak.rise).toBeGreaterThan(0);
    expect(Number.isFinite(r.trough.drop)).toBe(true);
    expect(r.durationS).toBeGreaterThanOrEqual(2);
  });
});
