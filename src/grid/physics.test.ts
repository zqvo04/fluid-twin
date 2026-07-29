/**
 * End-to-end physical verification of the grid -> compile -> solve pipeline:
 * a single pipe run built from tiles must reproduce the closed-form
 * Darcy-Weisbach head loss for the flow the solver converges to. This checks
 * the tile-to-PipeLink translation (length, diameter, roughness), not just
 * the solver formula (already covered by physics/steadySolver.test.ts).
 */

import { describe, it, expect } from 'vitest';
import { emptyGrid } from './types';
import { makeTile, placeTile, updateTile, DEFAULT_TILE_DEFAULTS } from './ops';
import { compile } from './compile';
import { solveSteadyState } from '../physics/steadySolver';
import { pipeGeometry } from '../domain/catalog/pipes';
import { waterProperties } from '../domain/fluid';
import { reynolds, churchillFriction } from '../physics/friction';
import { G } from '../domain/units';

describe('grid -> network -> solver reproduces Darcy-Weisbach', () => {
  it('matches the closed-form friction head loss for a straight run', () => {
    const cellSize = 2; // m
    const tileCount = 6;
    // A single row (elevation is the same everywhere) with the source head
    // explicitly overridden to 20 m above the default sink (elevation 0),
    // so the difference is pure friction loss — a clean closed-form check.
    let grid = emptyGrid(tileCount + 2, 1, cellSize);
    const source = makeTile('source', { col: 0, row: 0 }, 0, grid, DEFAULT_TILE_DEFAULTS);
    grid = placeTile(grid, source);
    grid = updateTile(grid, source.id, { head: 20 });
    for (let i = 0; i < tileCount; i++) {
      grid = placeTile(grid, makeTile('straight', { col: 1 + i, row: 0 }, 0, grid, DEFAULT_TILE_DEFAULTS));
    }
    grid = placeTile(grid, makeTile('sink', { col: tileCount + 1, row: 0 }, 0, grid, DEFAULT_TILE_DEFAULTS));

    const { network, issues } = compile(grid);
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);

    const pipe = network.links.find((l) => l.kind === 'pipe')!;
    expect(pipe.kind).toBe('pipe');
    if (pipe.kind !== 'pipe') return;
    expect(pipe.length).toBeCloseTo(tileCount * cellSize);

    const result = solveSteadyState(network);
    expect(result.converged).toBe(true);

    const flow = result.links.get(pipe.id)!.flow;
    const geo = pipeGeometry(pipe.nps, pipe.schedule);
    const fluid = waterProperties(grid.temperatureC);
    const re = reynolds(flow, geo.id, fluid.rho, fluid.mu);
    const f = churchillFriction(re, 0.045e-3 / geo.id);
    const velocity = Math.abs(flow) / geo.area;
    const expectedHeadLoss = (f * pipe.length!) / geo.id * (velocity * velocity) / (2 * G);

    const actualHeadLoss = 20 - 0; // source head 20, sink head 0 (both at elevation 0)
    expect(expectedHeadLoss).toBeCloseTo(actualHeadLoss, 2);
  });
});
