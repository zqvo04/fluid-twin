/**
 * Grid project serialization. The grid is what the user edits, so a project
 * file is just its versioned JSON — the PipelineNetwork is derived (compile.ts)
 * and never stored, so it can't drift out of sync with the grid.
 */

import { GridModel, Tile } from './types';
import { nextTag } from './tags';

export const GRID_SCHEMA_VERSION = 3;

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
  if (file.schemaVersion !== GRID_SCHEMA_VERSION && file.schemaVersion !== 1) {
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
  return file.schemaVersion === 1 ? migrateV1(grid) : grid;
}

/**
 * v1 (pre-V2) → v3: add `instruments`, give every equipment tile a tag in
 * file order, valves become manual (HV), pumps stay running — a v1 model
 * keeps exactly the hydraulics it was saved with.
 */
function migrateV1(v1: GridModel): GridModel {
  let grid: GridModel = { ...v1, tiles: [], instruments: [] };
  for (const old of v1.tiles as Tile[]) {
    let tile: Tile = old;
    if (old.kind === 'valve') tile = { ...old, service: 'manual', tag: nextTag(grid, 'HV') };
    if (old.kind === 'pump') tile = { ...old, running: true, tag: nextTag(grid, 'P') };
    grid = { ...grid, tiles: [...grid.tiles, tile] };
  }
  return grid;
}
