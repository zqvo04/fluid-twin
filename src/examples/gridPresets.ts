/**
 * Starter grid layouts for the "예제" menu — a quick way to see a working
 * network (and the pressure/flow visualization) without building one by
 * hand first. Each preset is just a sequence of makeTile/placeTile calls,
 * the same primitives the editor itself uses.
 */

import { cellElevation, emptyGrid, GridModel, Rotation } from '../grid/types';
import { makeTile, placeTile, tileAt, updateTile, DEFAULT_TILE_DEFAULTS, TileDefaults } from '../grid/ops';
import { TileKind } from '../grid/types';

const V = (rot: Rotation = 0, defaults: TileDefaults = DEFAULT_TILE_DEFAULTS) => ({ rot, defaults });

function build(cols: number, rows: number, cellSize: number, placements: Array<[TileKind, number, number, ReturnType<typeof V>?]>): GridModel {
  let grid = emptyGrid(cols, rows, cellSize);
  for (const [kind, col, row, opts] of placements) {
    const { rot, defaults } = opts ?? V();
    grid = placeTile(grid, makeTile(kind, { col, row }, rot, grid, defaults));
  }
  return grid;
}

/** Raise a source tile's head above its own elevation — an explicit,
 * visible "elevated feed tank" setup, since a plain IN no longer gets a
 * free head boost by default. */
function raiseSource(grid: GridModel, cell: { col: number; row: number }, aboveGrade: number): GridModel {
  const source = tileAt(grid, cell)!;
  return updateTile(grid, source.id, { head: cellElevation(grid, cell) + aboveGrade });
}

const seriesLine = () => {
  const grid = build(8, 5, 2, [
    ['source', 0, 2],
    ['straight', 1, 2],
    ['straight', 2, 2],
    ['straight', 3, 2],
    ['valve', 4, 2],
    ['straight', 5, 2],
    ['straight', 6, 2],
    ['sink', 7, 2],
  ]);
  // Same elevation start to finish, so without an explicit driving head
  // (and with no pump on this line) nothing would flow.
  return raiseSource(grid, { col: 0, row: 2 }, 6);
};

const branching = () => {
  const grid = build(5, 5, 2, [
    ['source', 0, 2],
    ['straight', 1, 2],
    ['tee', 2, 2], // rotation 0 -> ports W,E,S
    ['straight', 3, 2],
    ['sink', 4, 2],
    ['straight', 2, 3, V(90)], // vertical run down from the tee's S port
    ['sink', 2, 4, V(90)], // rotation 90 -> port N, receives from above
  ]);
  // The level branch (sink at row 2) has no natural elevation drop, so it
  // needs its own share of driving head too, on top of the down branch's
  // natural gravity feed — otherwise only the down branch would show flow.
  return raiseSource(grid, { col: 0, row: 2 }, 6);
};

const pumpBoost = () =>
  build(9, 5, 2, [
    ['source', 0, 2],
    ['straight', 1, 2],
    ['pump', 2, 2],
    ['straight', 3, 2],
    ['straight', 4, 2],
    ['valve', 5, 2],
    ['straight', 6, 2],
    ['straight', 7, 2],
    ['sink', 8, 2],
  ]);
// Source and sink sit at the same elevation with no head override, so this
// preset only flows because the pump (on by default) is driving it — turn
// the pump's speed to 0 in the Inspector and the flow stops.

export interface GridPreset {
  name: string;
  description: string;
  build: () => GridModel;
}

export const GRID_PRESETS: GridPreset[] = [
  { name: '직렬 배관', description: '소스 – 직관 – 밸브 – 싱크', build: seriesLine },
  { name: '분기 네트워크', description: '하나의 T자관에서 두 갈래로 분기', build: branching },
  { name: '펌프 승압', description: '펌프로 수두를 올려 밸브까지 공급', build: pumpBoost },
];
