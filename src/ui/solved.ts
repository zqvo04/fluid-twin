import { waterProperties } from '../domain/fluid';
import { GridModel } from '../grid/types';
import { SolvedState } from '../readouts';
import { SteadyUiResult } from './store';

/** The UI's worker result as readouts input; null unless converged (no numbers from a diverged solve). */
export function solvedState(result: SteadyUiResult | null, grid: GridModel): SolvedState | null {
  return result?.converged ? { heads: result.heads, links: result.links, fluid: waterProperties(grid.temperatureC) } : null;
}
