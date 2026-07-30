/**
 * Per-link cell-space polylines, used to place flow particles along a link
 * regardless of whether it's a multi-tile pipe run, a zero-length direct
 * hub-to-hub connector, or a valve/pump's own two-node link. Kept separate
 * from grid/compile.ts's node positions (elevation-only, y is what physics
 * cares about) — this is purely a rendering/animation concern.
 */

import { GridModel, Tile } from '../grid/types';
import { tilePorts } from '../grid/ports';
import { CompileResult } from '../grid/compile';
import { PipelineNetwork } from '../domain/network';

export interface CellPoint {
  col: number;
  row: number;
}

export interface LinkGeometry {
  /** Cell-space polyline the link's flow travels along, `from` -> `to`. */
  points: CellPoint[];
  /**
   * Length of that polyline in grid cells (floored, never 0).
   *
   * Particle motion is timed off this rather than off the link's physical
   * length, because the board draws one cell per `grid.cellSize` metres for
   * *every* link. Converting the solved velocity to cells/s once
   * (`V / cellSize`) and dividing by this gives one consistent rule; the old
   * per-link `physicalLength`, which was floored to half a cell for valves
   * and short connectors, made those links animate at twice the right speed.
   */
  cellLength: number;
}

function tileCenter(tile: Tile): CellPoint {
  return { col: tile.cell.col + 0.5, row: tile.cell.row + 0.5 };
}

/** The point on a tile's edge where port `d` connects to its neighbor. */
function portEdge(tile: Tile, d: import('../grid/types').Direction): CellPoint {
  const c = tileCenter(tile);
  switch (d) {
    case 'N':
      return { col: c.col, row: tile.cell.row };
    case 'S':
      return { col: c.col, row: tile.cell.row + 1 };
    case 'E':
      return { col: tile.cell.col + 1, row: c.row };
    case 'W':
      return { col: tile.cell.col, row: c.row };
  }
}

function tileIdFromNodeId(nodeId: string): string {
  const i = nodeId.indexOf(':');
  return i === -1 ? nodeId : nodeId.slice(0, i);
}

/** Anchor point for a node id: a port edge for a valve/pump side, else the
 * hub tile's center (tee/cross/source/sink, or a pass-through mid-run tile). */
function nodeAnchor(nodeId: string, byId: Map<string, Tile>): CellPoint | null {
  const tileId = tileIdFromNodeId(nodeId);
  const tile = byId.get(tileId);
  if (!tile) return null;
  if (tile.kind === 'valve' || tile.kind === 'pump') {
    const suffix = nodeId.slice(tileId.length + 1);
    const ports = tilePorts(tile);
    const dir = suffix === 'a' ? ports[0] : ports[1];
    return portEdge(tile, dir);
  }
  return tileCenter(tile);
}

export function buildLinkGeometries(grid: GridModel, compiled: CompileResult): Map<string, LinkGeometry> {
  const byId = new Map<string, Tile>();
  for (const t of grid.tiles) byId.set(t.id, t);

  const geometries = new Map<string, LinkGeometry>();
  const network: PipelineNetwork = compiled.network;

  for (const link of network.links) {
    const from = nodeAnchor(link.from, byId);
    const to = nodeAnchor(link.to, byId);
    if (!from || !to) continue;

    const runTileIds = compiled.linkRunTiles.get(link.id) ?? [];
    const mids = runTileIds
      .map((id) => byId.get(id))
      .filter((t): t is Tile => !!t)
      .map(tileCenter);

    const points = [from, ...mids, to];
    geometries.set(link.id, { points, cellLength: Math.max(polylineLength(points), 1e-3) });
  }

  return geometries;
}

/** Total length of a polyline, in cells. */
export function polylineLength(points: CellPoint[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].col - points[i].col;
    const dy = points[i + 1].row - points[i].row;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
}

/**
 * Point at fraction s *and* the unit tangent there. The tangent is what lets
 * a particle be offset sideways off the centreline (perpendicular to travel)
 * so the stream has a cross-section instead of being a single file.
 */
export function pointAndTangentAtFraction(points: CellPoint[], s: number): { point: CellPoint; tCol: number; tRow: number } {
  const point = pointAtFraction(points, s);
  if (points.length < 2) return { point, tCol: 1, tRow: 0 };

  // Tangent of the segment the fraction lands on.
  const segLens: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].col - points[i].col;
    const dy = points[i + 1].row - points[i].row;
    const len = Math.sqrt(dx * dx + dy * dy);
    segLens.push(len);
    total += len;
  }
  if (total < 1e-9) return { point, tCol: 1, tRow: 0 };

  let target = Math.max(0, Math.min(1, s)) * total;
  for (let i = 0; i < segLens.length; i++) {
    if (target <= segLens[i] || i === segLens.length - 1) {
      const len = Math.max(segLens[i], 1e-9);
      return {
        point,
        tCol: (points[i + 1].col - points[i].col) / len,
        tRow: (points[i + 1].row - points[i].row) / len,
      };
    }
    target -= segLens[i];
  }
  return { point, tCol: 1, tRow: 0 };
}

/** Interpolate a point along a polyline at fraction s (0..1) of its total length. */
export function pointAtFraction(points: CellPoint[], s: number): CellPoint {
  if (points.length === 1) return points[0];
  const segLens: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].col - points[i].col;
    const dy = points[i + 1].row - points[i].row;
    const len = Math.sqrt(dx * dx + dy * dy);
    segLens.push(len);
    total += len;
  }
  if (total < 1e-9) return points[0];

  let target = Math.max(0, Math.min(1, s)) * total;
  for (let i = 0; i < segLens.length; i++) {
    if (target <= segLens[i] || i === segLens.length - 1) {
      const f = segLens[i] < 1e-9 ? 0 : target / segLens[i];
      const a = points[i];
      const b = points[i + 1];
      return { col: a.col + (b.col - a.col) * f, row: a.row + (b.row - a.row) * f };
    }
    target -= segLens[i];
  }
  return points[points.length - 1];
}
