/**
 * Grid domain model — the puzzle-piece layer the user actually edits.
 *
 * Every tile occupies exactly one grid cell (no per-tile "span"); a long pipe
 * run is just several `straight` tiles placed in a row. The compiler
 * (compile.ts) fuses consecutive straight/elbow tiles into a single
 * `PipeLink` with length = tile count * cellSize, so "variable length" comes
 * from chaining cells rather than from a length field on the tile — one
 * fewer piece of state to keep consistent with the grid.
 *
 * Row 0 is the top of the screen; row index maps to elevation via
 * `(rows - 1 - row) * cellSize`, so north (row - 1) is "up" both on screen
 * and physically, matching the existing domain model's `position.y =
 * elevation` convention.
 */

import { NominalSize, Schedule } from '../domain/catalog/pipes';
import { ValveType } from '../domain/catalog/valves';
import { PumpSpec } from '../domain/catalog/pumps';

export type Direction = 'N' | 'E' | 'S' | 'W';
export type Rotation = 0 | 90 | 180 | 270;

export interface Cell {
  col: number;
  row: number;
}

interface TileBase {
  id: string;
  cell: Cell;
  rotation: Rotation;
  nps: NominalSize;
  schedule: Schedule;
}

/** Pure pass-through, no direction change. Ports (rotation 0): E, W. */
export interface StraightTile extends TileBase {
  kind: 'straight';
}

/** Pure pass-through, 90-degree bend. Ports (rotation 0): N, E. */
export interface ElbowTile extends TileBase {
  kind: 'elbow';
}

/** Junction, no link of its own. Ports (rotation 0): W, E, S. */
export interface TeeTile extends TileBase {
  kind: 'tee';
}

/** Junction, no link of its own. Ports (rotation 0): N, E, S, W. */
export interface CrossTile extends TileBase {
  kind: 'cross';
}

/** A lumped element: two nodes (in/out) joined by a ValveLink. Ports: E, W. */
export interface ValveTile extends TileBase {
  kind: 'valve';
  valveType: ValveType;
  /** Fractional opening 0 (closed) .. 1 (fully open). */
  opening: number;
}

/**
 * A lumped element: two nodes joined by a PumpLink. Unlike every other tile
 * its two ports are *not* interchangeable — port 0 (W at rotation 0) is the
 * suction the pump draws from, port 1 (E) the discharge it delivers to. See
 * ports.ts `pumpPorts`.
 */
export interface PumpTile extends TileBase {
  kind: 'pump';
  spec: PumpSpec;
  speedRatio: number;
  /**
   * Discharge check valve fitted (the normal installation). Blocks reverse
   * flow through the pump. Optional so v1 projects load; absent reads as
   * fitted — see `hasCheckValve` in domain/network.ts.
   */
  checkValve?: boolean;
}

/** Boundary node (reservoir, fixed head). Port: E. */
export interface SourceTile extends TileBase {
  kind: 'source';
  /** Fixed total head [m]. */
  head: number;
}

/** Boundary node (reservoir or fixed demand). Port: W. */
export interface SinkTile extends TileBase {
  kind: 'sink';
  mode: 'head' | 'demand';
  /** Used when mode === 'head': fixed total head [m]. */
  head: number;
  /** Used when mode === 'demand': fixed outflow [m^3/s]. */
  demand: number;
}

export type Tile =
  | StraightTile
  | ElbowTile
  | TeeTile
  | CrossTile
  | ValveTile
  | PumpTile
  | SourceTile
  | SinkTile;

export type TileKind = Tile['kind'];

export interface GridModel {
  cols: number;
  rows: number;
  /** Physical size of one cell [m]; pipe run length = tile count * cellSize. */
  cellSize: number;
  tiles: Tile[];
  temperatureC: number;
}

export function emptyGrid(cols: number, rows: number, cellSize = 1, temperatureC = 20): GridModel {
  return { cols, rows, cellSize, tiles: [], temperatureC };
}

export function cellKey(cell: Cell): string {
  return `${cell.col},${cell.row}`;
}

export function sameCell(a: Cell, b: Cell): boolean {
  return a.col === b.col && a.row === b.row;
}

export function inBounds(grid: GridModel, cell: Cell): boolean {
  return cell.col >= 0 && cell.col < grid.cols && cell.row >= 0 && cell.row < grid.rows;
}

/** Physical elevation [m] of a cell's row, screen-top = highest. */
export function cellElevation(grid: GridModel, cell: Cell): number {
  return (grid.rows - 1 - cell.row) * grid.cellSize;
}
