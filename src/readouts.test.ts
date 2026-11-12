import { describe, it, expect } from 'vitest';
import { elementReadout, streamTable } from './readouts';
import { compile } from './grid/compile';
import { coolingLoop, place } from './grid/testLoop';
import { updateTile } from './grid/ops';
import { emptyGrid, GridModel } from './grid/types';
import { solveSteadyState } from './physics/steadySolver';
import { G } from './domain/units';

function solved(grid: GridModel) {
  const compiled = compile(grid);
  const result = solveSteadyState(compiled.network);
  expect(result.converged).toBe(true);
  const read = (id: string) => elementReadout(grid, compiled, result, id)!;
  return { compiled, result, read };
}

describe('elementReadout — cooling loop tiles and instruments', () => {
  const { grid: base, ids } = coolingLoop();
  const grid: GridModel = {
    ...base,
    instruments: [
      { tag: 'FI-101', type: 'FI', targetId: ids.pump },
      { tag: 'FIC-101', type: 'FIC', targetId: ids.valve },
      { tag: 'PI-101', type: 'PI', targetId: ids.hx },
      { tag: 'PI-102', type: 'PI', targetId: ids.riser },
      { tag: 'LI-101', type: 'LI', targetId: ids.basin },
    ],
  };
  const { compiled, result, read } = solved(grid);
  const q = read(ids.pump).flowM3h!;

  it('one loop, one flow: every series element reads the same Q', () => {
    expect(q).toBeGreaterThan(18);
    for (const id of [ids.strainer, ids.hx, ids.valve, ids.elbow, ids.riser, ids.spray]) {
      expect(read(id).flowM3h).toBeCloseTo(q, 6);
    }
    expect(read(ids.basin).flowM3h).toBeCloseTo(q, 6); // basin outflow
  });

  it('basin: tag, level, pressure = ρg·level at the floor', () => {
    const r = read(ids.basin);
    expect(r).toMatchObject({ kind: 'basin', tag: 'TK-101', levelM: 1 });
    expect(r.pressureBarG).toBeCloseTo((result.fluid.rho * G * 1) / 1e5, 9);
  });

  it('pump: running, speed %, head rise = discharge − suction head', () => {
    const r = read(ids.pump);
    expect(r).toMatchObject({ kind: 'pump', tag: 'P-101A', running: true, speedPct: 100 });
    expect(r.velocityMs).toBeUndefined();
    // Same elevation both ports, so Δp = ρg·ΔH.
    expect(-r.dpBar!).toBeCloseTo((result.fluid.rho * G * r.headM!) / 1e5, 9);
    expect(r.headM).toBeGreaterThan(0);
  });

  it('strainer / hx / valve: inlet − outlet = dp, outlet is `pressureBarG`', () => {
    for (const id of [ids.strainer, ids.hx, ids.valve]) {
      const r = read(id);
      expect(r.dpBar).toBeCloseTo(r.inletPressureBarG! - r.pressureBarG!, 12);
      expect(r.dpBar).toBeGreaterThan(0);
      expect(r.velocityMs).toBeGreaterThan(0);
    }
    expect(read(ids.valve)).toMatchObject({ tag: 'FCV-101', openingPct: 100 });
  });

  it('spray: header pressure is gauge at the inlet; jet side is atmosphere', () => {
    const r = read(ids.spray);
    expect(r.kind).toBe('spray');
    expect(r.pressureBarG).toBe(r.inletPressureBarG);
    expect(r.pressureBarG).toBeGreaterThan(0);
  });

  it('pipe tiles read pressure at their own elevation along the run', () => {
    // Run FCV → elbow(z=0) → riser(z=1) → elbow(z=2) → CT: head falls linearly
    // over the 3 tiles, so riser vs first elbow = 1/3 of the run's loss + 1 m of lift.
    const run = compiled.network.links.find((l) => l.id === compiled.tileLink.get(ids.riser))!;
    const runLoss = result.heads.get(run.from)! - result.heads.get(run.to)!;
    const dp = read(ids.elbow).pressureBarG! - read(ids.riser).pressureBarG!;
    expect(dp).toBeCloseTo((result.fluid.rho * G * (Math.abs(runLoss) / 3 + 1)) / 1e5, 9);
  });

  it('instruments read their target through the same selector', () => {
    expect(read('FI-101')).toMatchObject({ kind: 'FI', unit: 'm³/h', value: q });
    expect(read('FIC-101')).toMatchObject({ kind: 'FIC', unit: 'm³/h', value: read(ids.valve).flowM3h });
    expect(read('PI-101')).toMatchObject({ kind: 'PI', unit: 'bar g', value: read(ids.hx).pressureBarG });
    expect(read('PI-102')).toMatchObject({ kind: 'PI', value: read(ids.riser).pressureBarG });
    expect(read('LI-101')).toMatchObject({ kind: 'LI', unit: 'm', value: 1 });
  });

  it('unsolved: static settings only', () => {
    const r = elementReadout(grid, compiled, null, ids.pump)!;
    expect(r).toEqual({ id: ids.pump, kind: 'pump', tag: 'P-101A', running: true, speedPct: 100 });
    expect(elementReadout(grid, compiled, null, 'LI-101')!.value).toBe(1);
    expect(elementReadout(grid, compiled, null, 'NOPE')).toBeNull();
  });

  it('stopped pump reads 0 % speed', () => {
    const g = updateTile(grid, ids.pump, { running: false });
    expect(elementReadout(g, compile(g), null, ids.pump)).toMatchObject({ running: false, speedPct: 0 });
  });

  it('stream table: one row per pipe run, consistent with element readouts', () => {
    const rows = streamTable(compiled, result);
    expect(rows.map((r) => r.stream)).toEqual(rows.map((_, i) => i + 1));
    // basin→S, S→P, P→E, E→FCV, FCV→riser→CT: 5 runs.
    expect(rows).toHaveLength(5);
    for (const row of rows) expect(Math.abs(row.flowM3h)).toBeCloseTo(q, 6);
    const riserRun = rows.find((r) => r.toId === ids.spray)!;
    expect(riserRun.fromId).toBe(ids.valve);
    expect(riserRun.pressureBarG).toBeCloseTo(read(ids.valve).pressureBarG!, 9);
  });
});

describe('elementReadout — V1 junction and boundary tiles', () => {
  it('source → tee → two sinks; cross with three sinks', () => {
    let g = emptyGrid(4, 3, 1);
    g = place(g, 'source', 0, 1, ['E']);
    g = place(g, 'tee', 1, 1, ['W', 'E', 'S']);
    g = place(g, 'sink', 2, 1, ['W']);
    g = place(g, 'sink', 1, 2, ['N']);
    const src = g.tiles[0].id;
    g = updateTile(g, src, { head: 5 });
    const { read } = solved(g);
    const tee = g.tiles[1].id;
    const qIn = read(src).flowM3h!;
    expect(qIn).toBeGreaterThan(0);
    expect(read(g.tiles[2].id).flowM3h! + read(g.tiles[3].id).flowM3h!).toBeCloseTo(-qIn, 6); // sinks: inflow is negative outflow
    expect(read(tee)).toMatchObject({ kind: 'tee' });
    expect(read(tee).pressureBarG).toBeGreaterThan(0);
    expect(read(tee).flowM3h).toBeUndefined();

    let x = emptyGrid(3, 3, 1);
    x = place(x, 'source', 0, 1, ['E']);
    x = place(x, 'cross', 1, 1, ['N', 'E', 'S', 'W']);
    x = place(x, 'sink', 2, 1, ['W']);
    x = place(x, 'sink', 1, 0, ['S']);
    x = place(x, 'sink', 1, 2, ['N']);
    x = updateTile(x, x.tiles[0].id, { head: 5 });
    const cr = solved(x).read(x.tiles[1].id);
    expect(cr.kind).toBe('cross');
    expect(cr.pressureBarG).toBeGreaterThan(0);
  });
});

describe('system readout', () => {
  it('throughput = flow delivered basin → spray = FI-101 on the reference loop', async () => {
    const { GRID_PRESETS } = await import('./examples/gridPresets');
    const { throughputM3h } = await import('./readouts');
    const g = GRID_PRESETS.find((p) => p.name === '개방형 냉각수 루프')!.build();
    const c = compile(g);
    const r = solveSteadyState(c.network);
    expect(throughputM3h(c, r)).toBeCloseTo(elementReadout(g, c, r, 'FI-101')!.value!, 6);
    expect(throughputM3h(c, r)).toBeGreaterThan(80);
  });
});
