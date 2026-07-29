import { describe, it, expect } from 'vitest';
import { GRID_PRESETS } from './gridPresets';
import { compile } from '../grid/compile';
import { solveSteadyState } from '../physics/steadySolver';

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
});
