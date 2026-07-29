/**
 * End-to-end verification of the grid -> compile -> MOC transient pipeline:
 * slamming a valve shut on a tile-built pipe run must reproduce the
 * closed-form Joukowsky surge (dH = a*V0/g) for the flow and pipe the grid
 * actually compiled to. Mirrors grid/physics.test.ts's steady-state check,
 * but for the transient solver and through the valve's :a/:b node split.
 */

import { describe, it, expect } from 'vitest';
import { emptyGrid } from './types';
import { makeTile, placeTile, updateTile, DEFAULT_TILE_DEFAULTS } from './ops';
import { compile } from './compile';
import { NetworkTransientSim } from '../physics/networkTransient';
import { pipeGeometry, A106B } from '../domain/catalog/pipes';
import { waterProperties } from '../domain/fluid';
import { waveSpeed } from '../physics/waveSpeed';
import { G } from '../domain/units';

describe('grid -> network -> MOC reproduces the Joukowsky surge', () => {
  it('matches a*V0/g when a valve on a tile-built line slams shut', () => {
    const cellSize = 20; // m — a long-ish line so the wave has room to travel
    const tileCount = 6;
    // A short real stub pipe sits on both sides of the valve (not a direct
    // hub-to-hub connector) so neither side's wave dynamics are dominated by
    // compile.ts's near-zero-length floor — that floored segment has its own
    // (artificially slow) wave speed and would otherwise beat against the
    // main line's reflections over many periods.
    let grid = emptyGrid(tileCount + 4, 1, cellSize);
    const source = makeTile('source', { col: 0, row: 0 }, 0, grid, DEFAULT_TILE_DEFAULTS);
    grid = placeTile(grid, source);
    // Explicit driving head (an elevated feed tank) — a source no longer
    // gets a free 20 m of head by default, so this test states its own.
    grid = updateTile(grid, source.id, { head: 20 });
    for (let i = 0; i < tileCount; i++) {
      grid = placeTile(grid, makeTile('straight', { col: 1 + i, row: 0 }, 0, grid, DEFAULT_TILE_DEFAULTS));
    }
    grid = placeTile(
      grid,
      makeTile('valve', { col: tileCount + 1, row: 0 }, 0, grid, { ...DEFAULT_TILE_DEFAULTS, valveType: 'ball' }),
    );
    grid = placeTile(grid, makeTile('straight', { col: tileCount + 2, row: 0 }, 0, grid, DEFAULT_TILE_DEFAULTS));
    grid = placeTile(grid, makeTile('sink', { col: tileCount + 3, row: 0 }, 0, grid, DEFAULT_TILE_DEFAULTS));

    const { network, issues } = compile(grid);
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);

    const pipe = network.links.find((l) => l.kind === 'pipe' && l.length && l.length > cellSize)!;
    expect(pipe.kind).toBe('pipe');
    if (pipe.kind !== 'pipe') return;
    const valveLink = network.links.find((l) => l.kind === 'valve')!;
    expect(valveLink.kind).toBe('valve');

    const sim = new NetworkTransientSim(network, 8, 0);
    const q0 = sim.pipeFlow(pipe.id);
    const geo = pipeGeometry(pipe.nps, pipe.schedule);
    const v0 = q0 / geo.area;
    expect(Math.abs(v0)).toBeGreaterThan(0.1); // there is real flow to arrest

    const fluid = waterProperties(grid.temperatureC);
    const a = waveSpeed(fluid.bulk, fluid.rho, geo.id, geo.wall, A106B.E);
    const joukowsky = (a * Math.abs(v0)) / G;

    // Slam the valve shut instantaneously and track the peak head just
    // upstream of it (the node the pipe run's `to` end lands on) — mirrors
    // physics/networkTransient.test.ts's existing single-pipe check, now
    // through the grid compiler and the valve's :a/:b node split.
    const upstreamNode = pipe.to;
    const initialHead = sim.headOf(upstreamNode);
    sim.setValveOpening(valveLink.id, 0);
    let peakRise = 0;
    for (let i = 0; i < 100; i++) {
      sim.step();
      const rise = sim.headOf(upstreamNode) - initialHead;
      if (rise > peakRise) peakRise = rise;
    }

    // Friction and the discretized MOC step shave a bit off the idealized
    // frictionless formula; the same ~15-25% band the existing solver-level
    // test uses for this exact solver.
    expect(peakRise).toBeGreaterThan(0.7 * joukowsky);
    expect(peakRise).toBeLessThan(1.1 * joukowsky);
  });
});
