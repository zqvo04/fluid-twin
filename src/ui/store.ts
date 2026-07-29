/**
 * App state (Zustand). Holds the grid the user edits, the viewport, editing
 * mode, and the structural compile result (which tiles ended up excluded).
 * The physics solve result is layered on top in Phase 3 without changing this
 * shape — `network` below is already the compiled PipelineNetwork it will
 * be solved from.
 */

import { create } from 'zustand';
import { Cell, GridModel, Rotation, Tile, TileKind, emptyGrid } from '../grid/types';
import { DEFAULT_TILE_DEFAULTS, TileDefaults, makeTile, placeTile, removeTileAt, rotateTileAt, tileAt, updateTile } from '../grid/ops';
import { compile, CompileResult } from '../grid/compile';
import { validateNetwork, ValidationIssue } from '../domain/network';
import { checkConnectors } from '../domain/connectivity';
import { defaultViewport, panBy, zoomAt, Viewport } from '../render/viewport';
import { NominalSize, Schedule } from '../domain/catalog/pipes';
import { ValveType } from '../domain/catalog/valves';

export type EditMode = 'place' | 'select' | 'delete';

function recompile(grid: GridModel): { compiled: CompileResult; issues: ValidationIssue[]; excluded: Set<string> } {
  const compiled = compile(grid);
  const issues = [...compiled.issues, ...validateNetwork(compiled.network), ...checkConnectors(compiled.network)];
  const excluded = new Set(grid.tiles.map((t) => t.id).filter((id) => !compiled.tileNodes.has(id) && !compiled.tileLink.has(id)));
  return { compiled, issues, excluded };
}

interface AppState {
  grid: GridModel;
  view: Viewport;

  mode: EditMode;
  armedKind: TileKind;
  armedRotation: Rotation;
  tileDefaults: TileDefaults;

  hoverCell: Cell | null;
  selectedTileId: string | null;

  compiled: CompileResult;
  issues: ValidationIssue[];
  excludedTileIds: Set<string>;

  setMode: (m: EditMode) => void;
  setArmedKind: (k: TileKind) => void;
  rotateArmed: () => void;
  setTileDefaults: (patch: Partial<TileDefaults>) => void;

  setHoverCell: (c: Cell | null) => void;
  clickCell: (c: Cell) => void;
  selectTile: (id: string | null) => void;
  updateSelectedTile: (patch: Partial<Tile>) => void;
  deleteSelected: () => void;

  setView: (v: Viewport) => void;
  panBy: (dx: number, dy: number) => void;
  zoomAt: (x: number, y: number, factor: number) => void;
  resetView: (width: number, height: number) => void;

  newGrid: (cols: number, rows: number, cellSize?: number) => void;
  loadGrid: (grid: GridModel) => void;
}

const INITIAL_GRID = emptyGrid(16, 10, 1);

export const useAppStore = create<AppState>((set, get) => ({
  grid: INITIAL_GRID,
  view: defaultViewport(960, 640, INITIAL_GRID.cols, INITIAL_GRID.rows),

  mode: 'place',
  armedKind: 'straight',
  armedRotation: 0,
  tileDefaults: DEFAULT_TILE_DEFAULTS,

  hoverCell: null,
  selectedTileId: null,

  ...(() => {
    const r = recompile(INITIAL_GRID);
    return { compiled: r.compiled, issues: r.issues, excludedTileIds: r.excluded };
  })(),

  setMode: (m) => set({ mode: m, selectedTileId: m === 'select' ? get().selectedTileId : null }),
  setArmedKind: (k) => set({ armedKind: k, mode: 'place' }),
  rotateArmed: () => set({ armedRotation: (((get().armedRotation + 90) % 360) as Rotation) }),
  setTileDefaults: (patch) => set({ tileDefaults: { ...get().tileDefaults, ...patch } }),

  setHoverCell: (c) => set({ hoverCell: c }),

  clickCell: (cell) => {
    const { grid, mode, armedKind, armedRotation, tileDefaults } = get();
    if (cell.col < 0 || cell.row < 0 || cell.col >= grid.cols || cell.row >= grid.rows) return;

    if (mode === 'delete') {
      const next = removeTileAt(grid, cell);
      const r = recompile(next);
      set({ grid: next, compiled: r.compiled, issues: r.issues, excludedTileIds: r.excluded, selectedTileId: null });
      return;
    }

    if (mode === 'select') {
      const t = tileAt(grid, cell);
      set({ selectedTileId: t?.id ?? null });
      return;
    }

    // mode === 'place'
    const existing = tileAt(grid, cell);
    if (existing && existing.kind === armedKind) {
      // Placing the same kind again on an occupied cell rotates it instead
      // of replacing it — a quicker way to orient a piece after dropping it.
      const next = rotateTileAt(grid, cell);
      const r = recompile(next);
      set({ grid: next, compiled: r.compiled, issues: r.issues, excludedTileIds: r.excluded });
      return;
    }
    const tile = makeTile(armedKind, cell, armedRotation, grid, tileDefaults);
    const next = placeTile(grid, tile);
    const r = recompile(next);
    set({ grid: next, compiled: r.compiled, issues: r.issues, excludedTileIds: r.excluded, selectedTileId: tile.id });
  },

  selectTile: (id) => set({ selectedTileId: id, mode: id ? 'select' : get().mode }),

  updateSelectedTile: (patch) => {
    const { grid, selectedTileId } = get();
    if (!selectedTileId) return;
    const next = updateTile(grid, selectedTileId, patch);
    const r = recompile(next);
    set({ grid: next, compiled: r.compiled, issues: r.issues, excludedTileIds: r.excluded });
  },

  deleteSelected: () => {
    const { grid, selectedTileId } = get();
    if (!selectedTileId) return;
    const tile = grid.tiles.find((t) => t.id === selectedTileId);
    if (!tile) return;
    const next = removeTileAt(grid, tile.cell);
    const r = recompile(next);
    set({ grid: next, compiled: r.compiled, issues: r.issues, excludedTileIds: r.excluded, selectedTileId: null });
  },

  setView: (v) => set({ view: v }),
  panBy: (dx, dy) => set({ view: panBy(get().view, dx, dy) }),
  zoomAt: (x, y, factor) => set({ view: zoomAt(get().view, x, y, factor) }),
  resetView: (width, height) => {
    const { grid } = get();
    set({ view: defaultViewport(width, height, grid.cols, grid.rows) });
  },

  newGrid: (cols, rows, cellSize = 1) => {
    const grid = emptyGrid(cols, rows, cellSize);
    const r = recompile(grid);
    set({
      grid,
      compiled: r.compiled,
      issues: r.issues,
      excludedTileIds: r.excluded,
      selectedTileId: null,
      view: defaultViewport(get().view.width, get().view.height, cols, rows),
    });
  },

  loadGrid: (grid) => {
    const r = recompile(grid);
    set({
      grid,
      compiled: r.compiled,
      issues: r.issues,
      excludedTileIds: r.excluded,
      selectedTileId: null,
      view: defaultViewport(get().view.width, get().view.height, grid.cols, grid.rows),
    });
  },
}));

// Re-export catalog types the UI needs alongside the store.
export type { NominalSize, Schedule, ValveType };
