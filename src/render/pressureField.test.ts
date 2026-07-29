import { describe, it, expect } from 'vitest';
import { emptyGrid } from '../grid/types';
import { makeTile, placeTile } from '../grid/ops';
import { compile } from '../grid/compile';
import { computePressureField, tilePressure } from './pressureField';
import { waterProperties } from '../domain/fluid';
import { headToPressure } from '../domain/units';

describe('pressureField', () => {
  it('converts node heads to gauge pressure using elevation and fluid density', () => {
    let grid = emptyGrid(3, 1, 1);
    grid = placeTile(grid, makeTile('source', { col: 0, row: 0 }, 0, grid));
    grid = placeTile(grid, makeTile('straight', { col: 1, row: 0 }, 0, grid));
    grid = placeTile(grid, makeTile('sink', { col: 2, row: 0 }, 0, grid));
    const compiled = compile(grid);

    const source = compiled.network.nodes.find((n) => n.type === 'reservoir' && n.id.startsWith('SRC'))!;
    const sink = compiled.network.nodes.find((n) => n.type === 'reservoir' && n.id.startsWith('SNK'))!;
    const heads = new Map([
      [source.id, 25],
      [sink.id, 20],
    ]);

    const field = computePressureField(grid, compiled, heads);
    const fluid = waterProperties(grid.temperatureC);
    expect(field.nodePressure.get(source.id)).toBeCloseTo(headToPressure(25 - source.position.y, fluid.rho));
    expect(field.max).toBeGreaterThan(field.min);
  });

  it('returns null for a tile with no resolved pressure and interpolates along a run', () => {
    let grid = emptyGrid(5, 1, 1);
    grid = placeTile(grid, makeTile('source', { col: 0, row: 0 }, 0, grid));
    const s1 = makeTile('straight', { col: 1, row: 0 }, 0, grid);
    grid = placeTile(grid, s1);
    const s2 = makeTile('straight', { col: 2, row: 0 }, 0, grid);
    grid = placeTile(grid, s2);
    grid = placeTile(grid, makeTile('sink', { col: 3, row: 0 }, 0, grid));
    const compiled = compile(grid);

    const source = compiled.network.nodes.find((n) => n.id.startsWith('SRC'))!;
    const sink = compiled.network.nodes.find((n) => n.id.startsWith('SNK'))!;
    const heads = new Map([
      [source.id, 30],
      [sink.id, 10],
    ]);
    const field = computePressureField(grid, compiled, heads);

    const p1 = tilePressure(s1.id, compiled, field)!;
    const p2 = tilePressure(s2.id, compiled, field)!;
    // The run is source -> s1 -> s2 -> sink; s1 sits closer to the high-head
    // source end, so its interpolated pressure should exceed s2's.
    expect(p1.pa).toBeGreaterThan(p2.pa);

    expect(tilePressure('NOPE', compiled, field)).toBeNull();
  });
});
