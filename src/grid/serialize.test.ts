import { describe, it, expect } from 'vitest';
import { serializeGrid, deserializeGrid, GRID_SCHEMA_VERSION } from './serialize';
import { emptyGrid } from './types';
import { makeTile, placeTile } from './ops';

describe('grid project serialization', () => {
  it('round-trips a grid without loss', () => {
    let grid = emptyGrid(6, 4, 1.5);
    grid = placeTile(grid, makeTile('source', { col: 0, row: 1 }, 0, grid));
    grid = placeTile(grid, makeTile('valve', { col: 2, row: 1 }, 0, grid));

    const restored = deserializeGrid(serializeGrid(grid));
    expect(restored.cols).toBe(6);
    expect(restored.rows).toBe(4);
    expect(restored.cellSize).toBe(1.5);
    expect(restored.tiles).toHaveLength(2);
  });

  it('rejects non-JSON input', () => {
    expect(() => deserializeGrid('{not json')).toThrow(/valid JSON/);
  });

  it('rejects an unsupported schema version', () => {
    const bad = JSON.stringify({ schemaVersion: 999, grid: emptyGrid(2, 2) });
    expect(() => deserializeGrid(bad)).toThrow(/schema version/);
  });

  it('rejects a file missing required grid fields', () => {
    const bad = JSON.stringify({ schemaVersion: GRID_SCHEMA_VERSION, grid: { cols: 2 } });
    expect(() => deserializeGrid(bad)).toThrow(/required grid fields/);
  });
});
