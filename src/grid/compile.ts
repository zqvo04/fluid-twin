/**
 * Grid -> network compiler. Turns the puzzle-piece GridModel into the
 * PipelineNetwork the physics solvers already understand.
 *
 * Node accounting:
 *  - tee / cross / source / sink each own exactly one node.
 *  - valve / pump each own two nodes ("<id>:a", "<id>:b", one per port) and
 *    the ValveLink/PumpLink directly joining them — they are links, not mere
 *    junctions.
 *  - straight / elbow tiles own no node at all; they are fused into whichever
 *    PipeLink their run belongs to (elbow contributes an `elbow90` fitting).
 *
 * Every run starts from a hub tile's port and is traced (merge.ts) until it
 * reaches another hub. Runs are undirected: once traced from one end, the
 * matching half-edge at the other end is marked so it isn't retraced.
 */

import {
  NetworkLink,
  NetworkNode,
  PipeLink,
  PipelineNetwork,
  PumpLink,
  ValidationIssue,
  ValveLink,
  Vec3,
} from '../domain/network';
import { FittingType } from '../domain/catalog/fittings';
import { Cell, Direction, GridModel, Tile, cellElevation, cellKey } from './types';
import { isPassThroughKind, tilePorts } from './ports';
import { tileMapByCell, traceRun } from './merge';

export interface CompileResult {
  network: PipelineNetwork;
  /** Hub tile id -> node id(s) it owns (1 for junctions/boundaries, 2 for valve/pump). */
  tileNodes: Map<string, string[]>;
  /** Any tile that ended up part of the network -> the link id it belongs to. */
  tileLink: Map<string, string>;
  /** Pipe link id -> ordered pass-through tile ids from `from` to `to` (for gradient rendering). */
  linkRunTiles: Map<string, string[]>;
  issues: ValidationIssue[];
}

function nodePosition(grid: GridModel, cell: Cell): Vec3 {
  return { x: cell.col * grid.cellSize, y: cellElevation(grid, cell), z: 0 };
}

function nodeIdForPort(tile: Tile, dir: Direction): string {
  if (tile.kind === 'valve' || tile.kind === 'pump') {
    const ports = tilePorts(tile);
    return ports.indexOf(dir) === 0 ? `${tile.id}:a` : `${tile.id}:b`;
  }
  return tile.id;
}

function hubNodes(tile: Tile, grid: GridModel): NetworkNode[] {
  const position = nodePosition(grid, tile.cell);
  switch (tile.kind) {
    case 'tee':
    case 'cross':
      return [{ id: tile.id, type: 'junction', position, demand: 0 }];
    case 'source':
      return [{ id: tile.id, type: 'reservoir', position, fixedHead: tile.head }];
    case 'sink':
      return tile.mode === 'head'
        ? [{ id: tile.id, type: 'reservoir', position, fixedHead: tile.head }]
        : [{ id: tile.id, type: 'junction', position, demand: tile.demand }];
    case 'valve':
    case 'pump':
      return [
        { id: `${tile.id}:a`, type: 'junction', position, demand: 0 },
        { id: `${tile.id}:b`, type: 'junction', position, demand: 0 },
      ];
    default:
      return [];
  }
}

export function compile(grid: GridModel): CompileResult {
  const byCell = tileMapByCell(grid);
  const nodes: NetworkNode[] = [];
  const links: NetworkLink[] = [];
  const tileNodes = new Map<string, string[]>();
  const tileLink = new Map<string, string>();
  const linkRunTiles = new Map<string, string[]>();
  const issues: ValidationIssue[] = [];

  const hubs = grid.tiles.filter((t) => !isPassThroughKind(t.kind));

  for (const tile of hubs) {
    const hn = hubNodes(tile, grid);
    nodes.push(...hn);
    tileNodes.set(tile.id, hn.map((n) => n.id));
  }

  // Valve/pump own a link directly — it has no pass-through chain to trace.
  for (const tile of hubs) {
    if (tile.kind === 'valve') {
      const link: ValveLink = {
        id: `L${tile.id}`,
        kind: 'valve',
        from: `${tile.id}:a`,
        to: `${tile.id}:b`,
        valveType: tile.valveType,
        nps: tile.nps,
        schedule: tile.schedule,
        opening: tile.opening,
      };
      links.push(link);
      tileLink.set(tile.id, link.id);
    } else if (tile.kind === 'pump') {
      const link: PumpLink = {
        id: `L${tile.id}`,
        kind: 'pump',
        from: `${tile.id}:a`,
        to: `${tile.id}:b`,
        spec: tile.spec,
        speedRatio: tile.speedRatio,
      };
      links.push(link);
      tileLink.set(tile.id, link.id);
    }
  }

  const resolved = new Set<string>(); // `${tileId}@${dir}` half-edges already traced
  let runCounter = 0;

  const markExcluded = (tiles: Tile[], detail: string) => {
    for (const t of tiles) {
      tileLink.delete(t.id);
      issues.push({
        severity: 'warning',
        message: `Pipe run through (${t.cell.col}, ${t.cell.row}) excluded — ${detail}.`,
        ref: t.id,
      });
    }
  };

  for (const tile of hubs) {
    for (const dir of tilePorts(tile)) {
      const half = `${tile.id}@${dir}`;
      if (resolved.has(half)) continue;
      resolved.add(half);

      const result = traceRun(byCell, tile.cell, dir);
      if (!result.ok) {
        markExcluded(
          result.tiles,
          result.reason === 'dangling'
            ? `unconnected port at (${result.atCell.col}, ${result.atCell.row})`
            : `misaligned tile at (${result.atCell.col}, ${result.atCell.row})`,
        );
        continue;
      }

      const endTile = byCell.get(cellKey(result.run.endCell))!;
      const endHalf = `${endTile.id}@${result.run.endDir}`;
      resolved.add(endHalf);

      const fromNode = nodeIdForPort(tile, dir);
      const toNode = nodeIdForPort(endTile, result.run.endDir);

      const fittings: FittingType[] = result.run.tiles
        .filter((t) => t.kind === 'elbow')
        .map((): FittingType => 'elbow90');

      // Size/schedule of the run: the first pass-through tile's, else the
      // originating hub's (a direct hub-to-hub connector with no pipe tile
      // between them).
      const spec = result.run.tiles[0] ?? tile;

      runCounter += 1;
      const link: PipeLink = {
        id: `RUN${runCounter}`,
        kind: 'pipe',
        from: fromNode,
        to: toNode,
        nps: spec.nps,
        schedule: spec.schedule,
        length: result.run.tiles.length * grid.cellSize,
        fittings: fittings.length ? fittings : undefined,
      };
      links.push(link);

      const tileIds = result.run.tiles.map((t) => t.id);
      for (const id of tileIds) tileLink.set(id, link.id);
      linkRunTiles.set(link.id, tileIds);
    }
  }

  const placed = new Set<string>([...tileNodes.keys(), ...tileLink.keys()]);
  for (const tile of grid.tiles) {
    if (!placed.has(tile.id)) {
      issues.push({
        severity: 'warning',
        message: `Tile at (${tile.cell.col}, ${tile.cell.row}) is isolated and excluded from the analysis.`,
        ref: tile.id,
      });
    }
  }

  const network: PipelineNetwork = {
    nodes,
    links,
    subAssemblies: [],
    sections: [],
    temperatureC: grid.temperatureC,
  };

  return { network, tileNodes, tileLink, linkRunTiles, issues };
}
