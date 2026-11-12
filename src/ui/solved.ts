import { useMemo } from 'react';
import { waterProperties } from '../domain/fluid';
import { GridModel } from '../grid/types';
import { gridAtFrame } from '../grid/scenario';
import { SolvedState } from '../readouts';
import { SteadyUiResult, activeFrame, useAppStore } from './store';

/** The UI's worker result as readouts input; null unless converged (no numbers from a diverged solve). */
export function solvedState(result: SteadyUiResult | null, grid: GridModel): SolvedState | null {
  return result?.converged ? { heads: result.heads, links: result.links, fluid: waterProperties(grid.temperatureC) } : null;
}

/**
 * What every view shows: the steady result on the editor's grid, or — during
 * scenario playback — the frame's result on the grid as it stands at that
 * frame. One switch for the canvas, the Inspector and the particles, so they
 * cannot show different moments.
 */
export function useDisplayState(): { grid: GridModel; solved: SolvedState | null; playing: boolean } {
  const grid = useAppStore((s) => s.grid);
  const result = useAppStore((s) => s.result);
  const frame = useAppStore(activeFrame);
  return useMemo(() => {
    if (frame) return { grid: gridAtFrame(grid, frame), solved: frame.result.converged ? frame.result : null, playing: true };
    return { grid, solved: solvedState(result, grid), playing: false };
  }, [grid, result, frame]);
}
