/**
 * Guided scenarios (PLAN-V2 §1.3): step cards with an instruction, the tab
 * to be on, the element concerned, and a completion predicate over readouts
 * (and the tab). The engine only advances; the user does the operating.
 */

import { CompileResult } from '../grid/compile';
import { GridModel } from '../grid/types';
import { Readout, SolvedState, elementReadout } from '../readouts';

export type Tab = 'pfd' | 'map';

export interface GuideContext {
  viewMode: Tab;
  /** Readout of an equipment or instrument tag; null if absent or unsolved. */
  read: (tag: string) => Readout | null;
}

export interface GuideStep {
  text: string;
  /** Tab the step is done on (shown on the card). */
  tab?: Tab;
  /** Tag of the element the step is about (highlighted on start). */
  target?: string;
  done: (c: GuideContext) => boolean;
}

export interface Guide {
  id: string;
  title: string;
  steps: GuideStep[];
}

export function guideContext(grid: GridModel, compiled: CompileResult, result: SolvedState | null, viewMode: Tab): GuideContext {
  return {
    viewMode,
    read: (tag) => {
      if (!result) return null;
      const tile = grid.tiles.find((t) => 'tag' in t && t.tag === tag);
      return elementReadout(grid, compiled, result, tile ? tile.id : tag);
    },
  };
}

/** First step from `index` whose condition does not hold yet (= steps.length when finished). */
export function advance(guide: Guide, index: number, c: GuideContext): number {
  let i = index;
  while (i < guide.steps.length && guide.steps[i].done(c)) i++;
  return i;
}
