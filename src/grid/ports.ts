/**
 * Port geometry: which sides of a cell a tile connects on, and how rotation
 * and neighbor lookups work. Kept separate from types.ts so the connectivity
 * rules (what "N" means, how rotation cycles) are in one small, testable file.
 */

import { Cell, Direction, Rotation, Tile, TileKind } from './types';

const ORDER: Direction[] = ['N', 'E', 'S', 'W'];

/** Ports at rotation 0, before rotating toward the tile's actual orientation. */
const BASE_PORTS: Record<TileKind, Direction[]> = {
  straight: ['E', 'W'],
  elbow: ['N', 'E'],
  tee: ['W', 'E', 'S'],
  cross: ['N', 'E', 'S', 'W'],
  valve: ['E', 'W'],
  pump: ['E', 'W'],
  source: ['E'],
  sink: ['W'],
};

/** Kinds that are a link in themselves (valve/pump) — two distinct nodes. */
export const LINK_HUB_KINDS: TileKind[] = ['valve', 'pump'];

/** Kinds that are a single junction node with no link of their own. */
export const JUNCTION_HUB_KINDS: TileKind[] = ['tee', 'cross', 'source', 'sink'];

/** Kinds that fuse into a pipe run rather than owning a node. */
export const PASS_THROUGH_KINDS: TileKind[] = ['straight', 'elbow'];

export function isHubKind(kind: TileKind): boolean {
  return LINK_HUB_KINDS.includes(kind) || JUNCTION_HUB_KINDS.includes(kind);
}

export function isPassThroughKind(kind: TileKind): boolean {
  return PASS_THROUGH_KINDS.includes(kind);
}

export function opposite(d: Direction): Direction {
  switch (d) {
    case 'N':
      return 'S';
    case 'S':
      return 'N';
    case 'E':
      return 'W';
    case 'W':
      return 'E';
  }
}

export function rotateDirection(d: Direction, rotation: Rotation): Direction {
  const steps = rotation / 90;
  const idx = (ORDER.indexOf(d) + steps) % 4;
  return ORDER[idx];
}

export function nextRotation(r: Rotation): Rotation {
  return (((r + 90) % 360) as Rotation);
}

/** A tile's ports in its current (rotated) orientation. */
export function tilePorts(tile: Tile): Direction[] {
  return BASE_PORTS[tile.kind].map((d) => rotateDirection(d, tile.rotation));
}

export function neighborCell(cell: Cell, d: Direction): Cell {
  switch (d) {
    case 'N':
      return { col: cell.col, row: cell.row - 1 };
    case 'S':
      return { col: cell.col, row: cell.row + 1 };
    case 'E':
      return { col: cell.col + 1, row: cell.row };
    case 'W':
      return { col: cell.col - 1, row: cell.row };
  }
}
