/**
 * Test fixture: the V2 open cooling loop in its smallest form.
 *
 *   row 0 (z=2)                 ┌─ spray CT-101
 *   row 1 (z=1)                 │
 *   row 2 (z=0)  TK─S─P─E─FCV───┘
 *
 * Basin TK-101 (floor 0 m, level 1 m) → strainer S-101 → pump P-101A →
 * hx E-101 → control valve FCV-101 → riser → spray CT-101 at 2 m.
 */

import { makeTile, placeTile, DEFAULT_TILE_DEFAULTS } from './ops';
import { tilePorts } from './ports';
import { Direction, GridModel, Rotation, TileKind, emptyGrid } from './types';

export function rotationFor(kind: TileKind, grid: GridModel, desired: Direction[]): Rotation {
  const want = [...desired].sort().join(',');
  for (const r of [0, 90, 180, 270] as Rotation[]) {
    if (tilePorts(makeTile(kind, { col: 0, row: 0 }, r, grid)).slice().sort().join(',') === want) return r;
  }
  throw new Error(`no rotation of ${kind} yields ports ${desired.join(',')}`);
}

export function place(grid: GridModel, kind: TileKind, col: number, row: number, ports: Direction[]): GridModel {
  return placeTile(grid, makeTile(kind, { col, row }, rotationFor(kind, grid, ports), grid, DEFAULT_TILE_DEFAULTS));
}

/** Tile ids by role, for assertions. */
export function coolingLoop(): { grid: GridModel; ids: Record<string, string> } {
  let grid = emptyGrid(7, 3, 1);
  grid = place(grid, 'basin', 0, 2, ['E']);
  grid = place(grid, 'strainer', 1, 2, ['E', 'W']);
  grid = place(grid, 'pump', 2, 2, ['W', 'E']);
  grid = place(grid, 'hx', 3, 2, ['E', 'W']);
  grid = place(grid, 'valve', 4, 2, ['E', 'W']);
  grid = place(grid, 'elbow', 5, 2, ['W', 'N']);
  grid = place(grid, 'straight', 5, 1, ['N', 'S']);
  grid = place(grid, 'elbow', 5, 0, ['S', 'E']);
  grid = place(grid, 'spray', 6, 0, ['W']);
  const at = (col: number, row: number) => grid.tiles.find((t) => t.cell.col === col && t.cell.row === row)!.id;
  const ids = {
    basin: at(0, 2),
    strainer: at(1, 2),
    pump: at(2, 2),
    hx: at(3, 2),
    valve: at(4, 2),
    elbow: at(5, 2),
    riser: at(5, 1),
    spray: at(6, 0),
  };
  // The FCV of the loop is a control valve.
  grid = {
    ...grid,
    tiles: grid.tiles.map((t) => (t.id === ids.valve && t.kind === 'valve' ? { ...t, service: 'control', tag: 'FCV-101' } : t)),
  };
  return { grid, ids };
}
