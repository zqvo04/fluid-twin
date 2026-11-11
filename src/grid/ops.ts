/**
 * Pure grid-editing operations. Every function returns a new GridModel
 * (immutable updates), mirroring domain/edit.ts's style so the store can diff
 * cheaply. One tile per cell: placing replaces whatever was there.
 */

import { PUMP_50M } from '../domain/catalog/pumps';
import { Cell, GridModel, Rotation, Tile, TileKind, cellElevation, sameCell } from './types';
import { nextRotation } from './ports';
import { nextTag } from './tags';

let counter = 0;

/** Generate an id unique within the grid (prefixed, human-readable). */
export function genTileId(prefix: string, grid: GridModel): string {
  const taken = new Set(grid.tiles.map((t) => t.id));
  let id: string;
  do {
    counter += 1;
    id = `${prefix}${counter}`;
  } while (taken.has(id));
  return id;
}

export interface TileDefaults {
  nps: import('../domain/catalog/pipes').NominalSize;
  schedule: import('../domain/catalog/pipes').Schedule;
  valveType: import('../domain/catalog/valves').ValveType;
}

export const DEFAULT_TILE_DEFAULTS: TileDefaults = { nps: '4"', schedule: '40', valveType: 'gate' };

/** Build a tile of the requested kind at a cell, with sensible defaults. */
const ID_PREFIX: Record<TileKind, string> = {
  straight: 'PIPE',
  elbow: 'ELB',
  tee: 'TEE',
  cross: 'CRS',
  valve: 'VLV',
  pump: 'PMP',
  source: 'SRC',
  sink: 'SNK',
  basin: 'TK',
  strainer: 'STR',
  hx: 'HX',
  spray: 'SPR',
};

export function makeTile(
  kind: TileKind,
  cell: Cell,
  rotation: Rotation,
  grid: GridModel,
  defaults: TileDefaults = DEFAULT_TILE_DEFAULTS,
): Tile {
  const id = genTileId(ID_PREFIX[kind], grid);
  const base = { id, cell, rotation, nps: defaults.nps, schedule: defaults.schedule };
  switch (kind) {
    case 'straight':
      return { ...base, kind: 'straight' };
    case 'elbow':
      return { ...base, kind: 'elbow' };
    case 'tee':
      return { ...base, kind: 'tee' };
    case 'cross':
      return { ...base, kind: 'cross' };
    case 'valve':
      return { ...base, kind: 'valve', tag: nextTag(grid, 'HV'), service: 'manual', valveType: defaults.valveType, opening: 1 };
    case 'pump': {
      // The B of a duty/standby pair is placed as the stopped standby.
      const tag = nextTag(grid, 'P');
      return { ...base, kind: 'pump', tag, spec: PUMP_50M, speedRatio: 1, checkValve: true, running: !tag.endsWith('B') };
    }
    case 'source':
      // No free head above grade: a newly placed IN is an open tank at its
      // own elevation, so flow to a same-elevation OUT needs a pump — head
      // is still freely editable in the Inspector for a "water tower" scenario.
      return { ...base, kind: 'source', head: cellElevation(grid, cell) };
    case 'sink':
      return { ...base, kind: 'sink', mode: 'head', head: cellElevation(grid, cell), demand: 0 };
    // Defaults are typical-order placeholders, editable in the Inspector.
    case 'basin':
      return { ...base, kind: 'basin', tag: nextTag(grid, 'TK'), area: 20, level: 1 };
    case 'strainer':
      return { ...base, kind: 'strainer', tag: nextTag(grid, 'S'), kClean: 1.5, clogging: 0 };
    case 'hx':
      return { ...base, kind: 'hx', tag: nextTag(grid, 'E'), designFlow: 0.02, designDp: 50_000 };
    case 'spray':
      return {
        ...base,
        kind: 'spray',
        tag: nextTag(grid, 'CT'),
        nozzleK: 2,
        returnBasinId: grid.tiles.find((t) => t.kind === 'basin')?.id ?? '',
      };
  }
}

export function tileAt(grid: GridModel, cell: Cell): Tile | undefined {
  return grid.tiles.find((t) => sameCell(t.cell, cell));
}

/** Place a tile, replacing whatever occupies its cell. */
export function placeTile(grid: GridModel, tile: Tile): GridModel {
  const tiles = grid.tiles.filter((t) => !sameCell(t.cell, tile.cell));
  return { ...grid, tiles: [...tiles, tile] };
}

export function removeTileAt(grid: GridModel, cell: Cell): GridModel {
  return { ...grid, tiles: grid.tiles.filter((t) => !sameCell(t.cell, cell)) };
}

export function rotateTileAt(grid: GridModel, cell: Cell): GridModel {
  return {
    ...grid,
    tiles: grid.tiles.map((t) =>
      sameCell(t.cell, cell) ? ({ ...t, rotation: nextRotation(t.rotation) } as Tile) : t,
    ),
  };
}

export function updateTile(grid: GridModel, id: string, patch: Partial<Tile>): GridModel {
  return {
    ...grid,
    tiles: grid.tiles.map((t) => (t.id === id ? ({ ...t, ...patch } as Tile) : t)),
  };
}

export function removeTileById(grid: GridModel, id: string): GridModel {
  return { ...grid, tiles: grid.tiles.filter((t) => t.id !== id) };
}
