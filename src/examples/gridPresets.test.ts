import { describe, it, expect } from 'vitest';
import { GRID_PRESETS } from './gridPresets';
import { compile } from '../grid/compile';
import { solveSteadyState } from '../physics/steadySolver';
import { updateTile } from '../grid/ops';

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
    for (const preset of GRID_PRESETS) {
      const grid = preset.build();
      const { network } = compile(grid);
      const result = solveSteadyState(network);
      const maxFlow = Math.max(...[...result.links.values()].map((l) => Math.abs(l.flow)));
      expect(maxFlow, `${preset.name} should have visible flow`).toBeGreaterThan(1e-4);
    }
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
    expect(stoppedFlow).toBeLessThan(1e-6);
  });
});
