/**
 * Run tracing: walks a chain of pass-through tiles (straight/elbow) starting
 * from a hub's port until it reaches another hub, a dangling port, or a
 * rotation mismatch. compile.ts uses this to fuse each chain into a single
 * PipeLink instead of one link per cell.
 *
 * Termination is guaranteed without an explicit visited-set: pass-through
 * tiles have exactly two ports (degree <= 2), so a walk can never branch or
 * revisit a cell — it can only run into a hub (which stops it) or off the
 * edge of what's placed (dangling). A step-count cap is kept anyway as a
 * cheap defensive bound for an interactive editor.
 */

import { Cell, Direction, GridModel, Tile, cellKey } from './types';
import { isPassThroughKind, neighborCell, opposite, tilePorts } from './ports';

export interface Run {
  /** Pass-through tiles in order from the starting hub to the terminal hub. */
  tiles: Tile[];
  endCell: Cell;
  /** The direction the terminal hub tile was entered from. */
  endDir: Direction;
}

export type TraceResult =
  | { ok: true; run: Run }
  | { ok: false; reason: 'dangling' | 'mismatch'; atCell: Cell; atDir: Direction; tiles: Tile[] };

export function tileMapByCell(grid: GridModel): Map<string, Tile> {
  const map = new Map<string, Tile>();
  for (const t of grid.tiles) map.set(cellKey(t.cell), t);
  return map;
}

/** Trace from a hub tile's port outward until the next hub (or a failure). */
export function traceRun(byCell: Map<string, Tile>, hubCell: Cell, exitDir: Direction): TraceResult {
  const tiles: Tile[] = [];
  let cell = neighborCell(hubCell, exitDir);
  let enterDir = opposite(exitDir);
  const maxSteps = byCell.size + 1;

  for (let step = 0; step < maxSteps; step++) {
    const tile = byCell.get(cellKey(cell));
    if (!tile) return { ok: false, reason: 'dangling', atCell: cell, atDir: enterDir, tiles };

    const ports = tilePorts(tile);
    if (!ports.includes(enterDir)) {
      return { ok: false, reason: 'mismatch', atCell: cell, atDir: enterDir, tiles };
    }

    if (!isPassThroughKind(tile.kind)) {
      return { ok: true, run: { tiles, endCell: tile.cell, endDir: enterDir } };
    }

    const exit = ports.find((d) => d !== enterDir)!;
    tiles.push(tile);
    cell = neighborCell(tile.cell, exit);
    enterDir = opposite(exit);
  }

  // Unreachable given the degree-<=2 argument above; kept as a hard stop.
  return { ok: false, reason: 'dangling', atCell: cell, atDir: enterDir, tiles };
}
