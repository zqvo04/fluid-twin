import { describe, it, expect } from 'vitest';
import { GRID_PRESETS } from './gridPresets';
import { compile } from '../grid/compile';
import { solveSteadyState } from '../physics/steadySolver';
import { updateTile } from '../grid/ops';
import { analyzePumpHealth } from '../analysis/pumpHealth';
import { waterProperties } from '../domain/fluid';

const CHURN_PRESET = '공회전 (체절)';

describe('grid presets', () => {
  for (const preset of GRID_PRESETS) {
    it(`"${preset.name}" compiles and solves cleanly`, () => {
      const grid = preset.build();
      const { network, issues } = compile(grid);
      expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
      expect(issues.filter((i) => i.severity === 'warning')).toHaveLength(0);

      const result = solveSteadyState(network);
      expect(result.converged).toBe(true);
    });
  }

  it('every preset actually shows flow out of the box (no silent zero-flow demo)', () => {
    // The churn preset is the exception: zero flow *is* what it demonstrates.
    for (const preset of GRID_PRESETS.filter((p) => p.name !== CHURN_PRESET)) {
      const grid = preset.build();
      const { network } = compile(grid);
      const result = solveSteadyState(network);
      const maxFlow = Math.max(...[...result.links.values()].map((l) => Math.abs(l.flow)));
      expect(maxFlow, `${preset.name} should have visible flow`).toBeGreaterThan(1e-4);
    }
  });

  it(`"${CHURN_PRESET}" shows a pump churning, and opening the valve relieves it`, () => {
    const preset = GRID_PRESETS.find((p) => p.name === CHURN_PRESET)!;
    let grid = preset.build();
    const fluid = waterProperties(grid.temperatureC);

    const shutNet = compile(grid).network;
    const shut = analyzePumpHealth(shutNet, solveSteadyState(shutNet), fluid)[0];
    expect(shut.state).toBe('churn');
    expect(shut.tempRiseRate).toBeGreaterThan(0);
    expect(Number.isFinite(shut.secondsToTempLimit)).toBe(true);

    const valve = grid.tiles.find((t) => t.kind === 'valve')!;
    grid = updateTile(grid, valve.id, { opening: 1 });
    const openNet = compile(grid).network;
    const open = analyzePumpHealth(openNet, solveSteadyState(openNet), fluid)[0];
    expect(open.state).not.toBe('churn');
    expect(open.stress).toBeLessThan(shut.stress);
  });

  it('"펌프 승압" only flows because the pump is running — stopping it kills the flow', () => {
    const preset = GRID_PRESETS.find((p) => p.name === '펌프 승압')!;
    let grid = preset.build();
    const pump = grid.tiles.find((t) => t.kind === 'pump')!;

    const runningNetwork = compile(grid).network;
    const running = solveSteadyState(runningNetwork);
    const runningFlow = Math.max(...[...running.links.values()].map((l) => Math.abs(l.flow)));
    expect(runningFlow).toBeGreaterThan(1e-4);

    grid = updateTile(grid, pump.id, { speedRatio: 0 });
    const stoppedNetwork = compile(grid).network;
    const stopped = solveSteadyState(stoppedNetwork);
    const stoppedFlow = Math.max(...[...stopped.links.values()].map((l) => Math.abs(l.flow)));
    // The blocked pump is a very large but finite resistance, so the delivery
    // tank's static head still drives an utterly negligible trickle back
    // through it rather than an exact zero.
    expect(stoppedFlow).toBeLessThan(runningFlow / 1000);
  });
});

describe('V2 reference: open cooling loop (P5-1)', () => {
  const preset = GRID_PRESETS.find((p) => p.name === '개방형 냉각수 루프')!;
  const grid = preset.build();
  const compiled = compile(grid);
  const result = solveSteadyState(compiled.network);
  const byTag = (tag: string) => grid.tiles.find((t) => 'tag' in t && t.tag === tag)!;

  it('has the PFD equipment and instruments by tag', () => {
    for (const tag of ['TK-101', 'S-101', 'P-101A', 'P-101B', 'E-101', 'FCV-101', 'HV-102', 'CT-101']) expect(byTag(tag)).toBeDefined();
    expect(grid.instruments.map((i) => i.tag)).toEqual(['FI-101', 'PI-101', 'LI-101']);
    expect(byTag('P-101B')).toMatchObject({ running: false });
    expect(byTag('HV-102')).toMatchObject({ opening: 0, service: 'manual' });
    expect(byTag('FCV-101')).toMatchObject({ service: 'control' });
    expect(compiled.issues).toEqual([]);
  });

  it('converges with P-101A inside 70–120 % of its BEP flow', () => {
    expect(result.converged).toBe(true);
    const pump = byTag('P-101A');
    const q = result.links.get(compiled.tileLink.get(pump.id)!)!.flow;
    const bep = pump.kind === 'pump' ? pump.spec.bepFlow : NaN;
    expect(q / bep).toBeGreaterThan(0.7);
    expect(q / bep).toBeLessThan(1.2);
    // Standby B is a blocked line, not a bypass.
    expect(Math.abs(result.links.get(compiled.tileLink.get(byTag('P-101B').id)!)!.flow)).toBeLessThan(1e-4);
  });
});
