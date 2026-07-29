/**
 * Grid project serialization. The grid is what the user edits, so a project
 * file is just its versioned JSON — the PipelineNetwork is derived (compile.ts)
 * and never stored, so it can't drift out of sync with the grid.
 */

import { GridModel } from './types';

export const GRID_SCHEMA_VERSION = 1;

export interface GridProjectFile {
  schemaVersion: number;
  savedAt: string;
  grid: GridModel;
}

export function serializeGrid(grid: GridModel): string {
  const file: GridProjectFile = {
    schemaVersion: GRID_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    grid,
  };
  return JSON.stringify(file, null, 2);
}

export function deserializeGrid(json: string): GridModel {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Project file is not valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Project file is empty or not an object.');
  }
  const file = parsed as Partial<GridProjectFile>;
  if (file.schemaVersion !== GRID_SCHEMA_VERSION) {
    throw new Error(`Unsupported project schema version ${file.schemaVersion ?? '(missing)'}; expected ${GRID_SCHEMA_VERSION}.`);
  }
  const grid = file.grid;
  if (
    !grid ||
    typeof grid.cols !== 'number' ||
    typeof grid.rows !== 'number' ||
    typeof grid.cellSize !== 'number' ||
    !Array.isArray(grid.tiles)
  ) {
    throw new Error('Project file is missing required grid fields.');
  }
  return grid;
}
