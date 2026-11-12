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
  // A pump is the one two-port tile whose ports are not interchangeable:
  // port 0 is the suction, port 1 the discharge (compile.ts maps them to the
  // PumpLink's `from`/`to` in that order). W first so an unrotated pump draws
  // fluid from the left and delivers to the right, matching how a line reads.
  pump: ['W', 'E'],
  source: ['E'],
  sink: ['W'],
  basin: ['E'],
  strainer: ['E', 'W'],
  hx: ['E', 'W'],
  spray: ['W'],
};

/**
 * Kinds that are a link in themselves — two nodes `<id>:a` (port 0) and
 * `<id>:b` joined by their own link. A spray has one port: `:a` is its inlet
 * junction, `:b` the atmospheric discharge boundary behind the nozzle.
 */
export const LINK_HUB_KINDS: TileKind[] = ['valve', 'pump', 'strainer', 'hx', 'spray'];

/** Kinds that are a single junction node with no link of their own. */
export const JUNCTION_HUB_KINDS: TileKind[] = ['tee', 'cross', 'source', 'sink', 'basin'];

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

/**
 * A pump tile's suction and discharge sides in its current orientation.
 * Single source of truth for "which way does this pump face" — the compiler
 * (node ordering) and the renderer (direction arrow) must not disagree.
 */
export function pumpPorts(tile: Tile): { suction: Direction; discharge: Direction } {
  const [suction, discharge] = tilePorts(tile);
  return { suction, discharge };
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
