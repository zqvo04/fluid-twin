import { describe, it, expect } from 'vitest';
import { runScenario, basinNetInflow, ScenarioFrame, ScenarioModel } from './scenario';
import { solveSteadyState } from './steadySolver';
import { PipelineNetwork, PumpLink } from '../domain/network';
import { PUMP_50M } from '../domain/catalog/pumps';
import { pipeGeometry } from '../domain/catalog/pipes';
import { valveK } from '../domain/catalog/valves';
import { G } from '../domain/units';
import { compile } from '../grid/compile';
import { scenarioModel, networkEvents } from '../grid/scenario';
import { coolingLoop, place } from '../grid/testLoop';
import { emptyGrid, GridModel } from '../grid/types';
import { updateTile } from '../grid/ops';

const H1 = 10; // suction reservoir head [m]
const H2 = 30; // delivery reservoir head [m]

/** R1 → pump(s) → J → globe valve → R2. A valve's resistance is exactly quadratic. */
function pumpNetwork(pumps: number, opts: { speedB?: number } = {}): PipelineNetwork {
  const links: PipelineNetwork['links'] = [];
  for (let i = 0; i < pumps; i++) {
    links.push({ id: `P${i}`, kind: 'pump', from: 'R1', to: 'J', spec: PUMP_50M, speedRatio: i === 1 ? opts.speedB ?? 1 : 1 });
  }
  links.push({ id: 'V', kind: 'valve', from: 'J', to: 'R2', valveType: 'globe', nps: '4"', schedule: '40', opening: 1 });
  return {
    nodes: [
      { id: 'R1', type: 'reservoir', position: { x: 0, y: 0, z: 0 }, fixedHead: H1 },
      { id: 'J', type: 'junction', position: { x: 1, y: 0, z: 0 }, demand: 0 },
      { id: 'R2', type: 'reservoir', position: { x: 2, y: 0, z: 0 }, fixedHead: H2 },
    ],
    links,
    subAssemblies: [],
    temperatureC: 20,
  };
}

const model = (network: PipelineNetwork): ScenarioModel => ({
  network,
  basins: [],
  nominalSpeed: Object.fromEntries(network.links.filter((l) => l.kind === 'pump').map((l) => [l.id, 1])),
});

const frames = (m: ScenarioModel, ev: Parameters<typeof runScenario>[1], durationS: number, dt = 0.5): ScenarioFrame[] => [
  ...runScenario(m, ev, { durationS, dt }),
];

/** System resistance r of the valve: h = r·Q². */
const rValve = () => {
  const A = pipeGeometry('4"', '40').area;
  return valveK('globe', '4"', '40', 1) / (2 * G * A * A);
};

/** Root of (a2' + r)Q² + a1'Q + (Δh − a0) = 0 for a pump curve a0 − a1'Q − a2'Q². */
const operatingFlow = (a0: number, a1: number, a2: number) => {
  const A = a2 + rValve();
  const C = H2 - H1 - a0;
  return (-a1 + Math.sqrt(a1 * a1 - 4 * A * C)) / (2 * A);
};

describe('V&V-4 single pump operating point', () => {
  it('pump curve ∩ system curve = quadratic root', () => {
    const [f] = frames(model(pumpNetwork(1)), [], 0);
    const q = f.result.links.get('P0')!.flow;
    const { a0, a1, a2 } = PUMP_50M;
    expect(Math.abs(q / operatingFlow(a0, a1, a2) - 1)).toBeLessThan(1e-6);
  });
});

describe('V&V-5 parallel pumps A+B', () => {
  it('two identical pumps = composite curve H(Q/2) ∩ system', () => {
    const [f] = frames(model(pumpNetwork(2)), [], 0);
    const qA = f.result.links.get('P0')!.flow;
    const qB = f.result.links.get('P1')!.flow;
    const { a0, a1, a2 } = PUMP_50M;
    // Same head at Q/2 each: a0 − a1(Q/2) − a2(Q/2)² → coefficients a1/2, a2/4.
    const q = operatingFlow(a0, a1 / 2, a2 / 4);
    expect(Math.abs((qA + qB) / q - 1)).toBeLessThan(1e-6);
    expect(qA).toBeCloseTo(qB, 10);
  });

  it('A → B switchover ends at the single-pump duty point', () => {
    // B standby (stopped); start B over 2 s at t=1, trip A at t=4.
    const fs = frames(
      model(pumpNetwork(2, { speedB: 0 })),
      [
        { kind: 'pumpStart', t: 1, id: 'P1', rampS: 2 },
        { kind: 'pumpStop', t: 4, id: 'P0' },
      ],
      120,
    );
    const at = (t: number) => fs.find((f) => Math.abs(f.t - t) < 1e-9)!;
    expect(at(0).speeds.P1).toBe(0);
    expect(at(2).speeds.P1).toBeCloseTo(0.5, 12); // linear ramp
    expect(at(3).speeds.P1).toBe(1);
    // A coasts down monotonically; flow never drops out during the change-over.
    const sA = fs.filter((f) => f.t >= 4).map((f) => f.speeds.P0);
    for (let i = 1; i < sA.length; i++) expect(sA[i]).toBeLessThanOrEqual(sA[i - 1]);
    expect(sA[sA.length - 1]).toBeLessThan(0.1);
    expect(Math.min(...fs.map((f) => f.result.links.get('V')!.flow))).toBeGreaterThan(0.02);
    const end = fs[fs.length - 1].result;
    const { a0, a1, a2 } = PUMP_50M;
    expect(end.links.get('P1')!.flow / operatingFlow(a0, a1, a2)).toBeCloseTo(1, 2);
  });
});

describe('valve stroke', () => {
  it('moves the opening linearly over the stroke time and throttles the flow', () => {
    const fs = frames(model(pumpNetwork(1)), [{ kind: 'valveStroke', t: 1, id: 'V', target: 0.2, timeS: 4 }], 6);
    const op = (t: number) => fs.find((f) => Math.abs(f.t - t) < 1e-9)!.openings.V;
    expect(op(1)).toBe(1);
    expect(op(3)).toBeCloseTo(0.6, 12);
    expect(op(5)).toBeCloseTo(0.2, 12);
    expect(op(6)).toBeCloseTo(0.2, 12);
    const q = fs.map((f) => f.result.links.get('V')!.flow);
    for (let i = 1; i < q.length; i++) expect(q[i]).toBeLessThanOrEqual(q[i - 1] + 1e-12);
    expect(q[q.length - 1]).toBeLessThan(q[0] * 0.8);
  });
});

describe('V&V-6 basin mass conservation', () => {
  it('∫(Q_in − Q_out)dt = A·Δh per basin, total volume conserved', () => {
    // TK-101 (A=20 m²) → pump → spray returning to TK-102 (A=35 m²).
    let g: GridModel = emptyGrid(6, 3, 1);
    g = place(g, 'basin', 0, 2, ['E']);
    g = place(g, 'pump', 1, 2, ['W', 'E']);
    g = place(g, 'straight', 2, 2, ['E', 'W']);
    g = place(g, 'elbow', 3, 2, ['W', 'N']);
    g = place(g, 'straight', 3, 1, ['N', 'S']);
    g = place(g, 'elbow', 3, 0, ['S', 'E']);
    g = place(g, 'spray', 4, 0, ['W']);
    g = place(g, 'basin', 5, 2, ['E']); // the second basin only receives spray
    const [tk1, , , , , , spray, tk2] = g.tiles.map((t) => t.id);
    g = updateTile(updateTile(g, spray, { returnBasinId: tk2 }), tk2, { area: 35, level: 0.5 });
    const compiled = compile(g);
    const m = scenarioModel(g, compiled);
    const dt = 0.5;
    const fs = frames(m, [], 60, dt);

    for (const b of m.basins) {
      let integral = 0;
      for (const f of fs.slice(0, -1)) {
        const net = { ...m.network, nodes: m.network.nodes.map((n) => (n.id === b.nodeId ? { ...n, fixedHead: b.floor + f.levels[n.id] } : n)) };
        integral += basinNetInflow(net, f.result, b) * dt;
      }
      const dh = fs[fs.length - 1].levels[b.nodeId] - b.level;
      expect(Math.abs(integral - b.area * dh)).toBeLessThan(1e-6 * Math.abs(integral));
    }
    const vol = (f: ScenarioFrame) => m.basins.reduce((s, b) => s + b.area * f.levels[b.nodeId], 0);
    expect(Math.abs(vol(fs[fs.length - 1]) / vol(fs[0]) - 1)).toBeLessThan(1e-9);
    expect(fs[fs.length - 1].levels[tk1]).toBeLessThan(1 - 0.05); // TK-101 drains
  });
});

describe('V&V-7 quasi-steady consistency', () => {
  it('an event-free scenario equals the steady solution at every step', () => {
    const { grid } = coolingLoop();
    const compiled = compile(grid);
    const steady = solveSteadyState(compiled.network);
    const fs = frames(scenarioModel(grid, compiled), [], 10);
    expect(fs).toHaveLength(21);
    for (const f of fs) {
      for (const [id, h] of steady.heads) expect(f.result.heads.get(id)).toBeCloseTo(h, 9);
      for (const [id, l] of steady.links) expect(f.result.links.get(id)!.flow).toBeCloseTo(l.flow, 9);
    }
  });

  it('grid events are re-addressed to link ids', () => {
    const { grid, ids } = coolingLoop();
    const compiled = compile(grid);
    const [e] = networkEvents(compiled, [{ kind: 'pumpStop', t: 0, id: ids.pump }]);
    expect(e.id).toBe(compiled.tileLink.get(ids.pump));
    expect((compiled.network.links.find((l) => l.id === e.id) as PumpLink).kind).toBe('pump');
  });
});

describe('basin running dry (F5)', () => {
  it('never goes below empty; the pumps drawing on it lose prime and stop delivering', () => {
    // TK-1 (0.5 m², 0.2 m of water) → pump → spray into TK-2: empties in a few seconds.
    let g: GridModel = emptyGrid(6, 3, 1);
    g = place(g, 'basin', 0, 2, ['E']);
    g = place(g, 'pump', 1, 2, ['W', 'E']);
    g = place(g, 'straight', 2, 2, ['E', 'W']);
    g = place(g, 'elbow', 3, 2, ['W', 'N']);
    g = place(g, 'straight', 3, 1, ['N', 'S']);
    g = place(g, 'elbow', 3, 0, ['S', 'E']);
    g = place(g, 'spray', 4, 0, ['W']);
    g = place(g, 'basin', 5, 2, ['E']);
    const [tk1, pump, , , , , spray, tk2] = g.tiles.map((t) => t.id);
    g = updateTile(updateTile(updateTile(g, spray, { returnBasinId: tk2 }), tk1, { area: 0.5, level: 0.2 }), tk2, { area: 20 });
    const compiled = compile(g);
    const m = scenarioModel(g, compiled);
    const dt = 0.5;
    const fs = frames(m, [], 20, dt);
    const link = compiled.tileLink.get(pump)!;

    for (const f of fs) {
      expect(f.result.converged, `t=${f.t}`).toBe(true);
      expect(f.levels[tk1]).toBeGreaterThanOrEqual(0);
    }
    const dry = fs.filter((f) => f.dryBasins.includes(tk1));
    expect(dry.length).toBeGreaterThan(10); // dry for most of the run
    // Unprimed pump = blocked line: only the solver's blocked-pump leak (~1e-6 m³/s, shown as 0.0 m³/h).
    for (const f of dry) expect(Math.abs(f.result.links.get(link)!.flow)).toBeLessThan(1e-5);
    // Prime is lost before a step could overdraw: a little water is left, none is created.
    expect(fs[fs.length - 1].levels[tk1]).toBeLessThan(0.06);
    const vol = (f: ScenarioFrame) => 0.5 * f.levels[tk1] + 20 * f.levels[tk2];
    expect(Math.abs(vol(fs[fs.length - 1]) / vol(fs[0]) - 1)).toBeLessThan(1e-9);
  });
});

describe('rotor coast-down (F5)', () => {
  it('bearing/seal drag stops a tripped rotor in finite time', () => {
    const fs = frames(model(pumpNetwork(1)), [{ kind: 'pumpStop', t: 0, id: 'P0' }], 300);
    const stop = fs.find((f) => f.speeds.P0 === 0);
    expect(stop).toBeDefined();
    expect(stop!.t).toBeLessThan(300);
    for (let i = 1; i < fs.length; i++) expect(fs[i].speeds.P0).toBeLessThanOrEqual(fs[i - 1].speeds.P0);
  });
});
