import { describe, it, expect } from 'vitest';
import { solveSteadyState } from '../physics/steadySolver';
import { emptyGrid, Direction, Rotation, TileKind, GridModel } from './types';
import { makeTile, placeTile, DEFAULT_TILE_DEFAULTS } from './ops';
import { tilePorts } from './ports';
import { compile } from './compile';
import { validateGrid } from './validate';

/** Find the rotation that gives a tile exactly this set of ports (order-free). */
function rotationFor(kind: TileKind, grid: GridModel, desired: Direction[]): Rotation {
  const want = [...desired].sort().join(',');
  for (const r of [0, 90, 180, 270] as Rotation[]) {
    const probe = makeTile(kind, { col: 0, row: 0 }, r, grid);
    if (tilePorts(probe).slice().sort().join(',') === want) return r;
  }
  throw new Error(`no rotation of ${kind} yields ports ${desired.join(',')}`);
}

function place(grid: GridModel, kind: TileKind, cell: { col: number; row: number }, ports: Direction[]) {
  const rot = rotationFor(kind, grid, ports);
  const tile = makeTile(kind, cell, rot, grid, DEFAULT_TILE_DEFAULTS);
  return { grid: placeTile(grid, tile), tile };
}

describe('grid compiler — straight run merge', () => {
  it('fuses consecutive straight tiles into one PipeLink with summed length', () => {
    let grid = emptyGrid(5, 1, 2 /* cellSize m */);
    ({ grid } = place(grid, 'source', { col: 0, row: 0 }, ['E']));
    ({ grid } = place(grid, 'straight', { col: 1, row: 0 }, ['E', 'W']));
    ({ grid } = place(grid, 'straight', { col: 2, row: 0 }, ['E', 'W']));
    ({ grid } = place(grid, 'straight', { col: 3, row: 0 }, ['E', 'W']));
    ({ grid } = place(grid, 'sink', { col: 4, row: 0 }, ['W']));

    const { network, issues, linkRunTiles } = compile(grid);
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(network.nodes).toHaveLength(2);
    expect(network.links).toHaveLength(1);

    const pipe = network.links[0];
    expect(pipe.kind).toBe('pipe');
    if (pipe.kind === 'pipe') {
      expect(pipe.length).toBeCloseTo(3 * 2); // 3 straight tiles * cellSize
    }
    expect(linkRunTiles.get(pipe.id)).toHaveLength(3);
  });
});

describe('grid compiler — elbow folds into the run as a fitting', () => {
  it('adds an elbow90 fitting and counts the elbow as one length unit', () => {
    let grid = emptyGrid(2, 2, 1);
    ({ grid } = place(grid, 'source', { col: 0, row: 1 }, ['E']));
    // Elbow at (1,1) must accept from W and exit N (up toward row 0).
    ({ grid } = place(grid, 'elbow', { col: 1, row: 1 }, ['W', 'N']));
    ({ grid } = place(grid, 'sink', { col: 1, row: 0 }, ['S']));

    const { network, issues } = compile(grid);
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(network.links).toHaveLength(1);
    const pipe = network.links[0];
    expect(pipe.kind).toBe('pipe');
    if (pipe.kind === 'pipe') {
      expect(pipe.length).toBeCloseTo(1);
      expect(pipe.fittings).toEqual(['elbow90']);
    }
  });
});

describe('grid compiler — tee junction', () => {
  it('creates one node with three links, including a near-zero-length direct connector', () => {
    let grid = emptyGrid(3, 1, 1);
    ({ grid } = place(grid, 'source', { col: 0, row: 0 }, ['E']));
    const teePlacement = place(grid, 'tee', { col: 1, row: 0 }, ['W', 'E', 'N']);
    grid = teePlacement.grid;
    const tee = teePlacement.tile;
    ({ grid } = place(grid, 'sink', { col: 2, row: 0 }, ['W']));
    // Tee's third port (N) is left unconnected on purpose (out of grid bounds) —
    // traceRun reports it as dangling but doesn't otherwise affect the rest.

    const { network, tileNodes } = compile(grid);
    expect(network.nodes).toHaveLength(3); // source, tee, sink
    expect(network.links).toHaveLength(2); // source-tee, tee-sink (both direct connectors)
    for (const l of network.links) {
      expect(l.kind).toBe('pipe');
      // Floored to a small positive length (not exactly 0) so the MOC
      // transient solver never sees a zero wave-travel time on this link.
      if (l.kind === 'pipe') expect(l.length).toBeCloseTo(grid.cellSize * 0.1);
    }
    expect(tileNodes.get(tee.id)).toEqual([tee.id]);
  });
});

describe('grid compiler — valve as a two-node link', () => {
  it('splits a valve tile into :a/:b nodes joined by a ValveLink', () => {
    let grid = emptyGrid(4, 1, 1);
    ({ grid } = place(grid, 'source', { col: 0, row: 0 }, ['E']));
    ({ grid } = place(grid, 'straight', { col: 1, row: 0 }, ['E', 'W']));
    ({ grid } = place(grid, 'valve', { col: 2, row: 0 }, ['E', 'W']));
    ({ grid } = place(grid, 'sink', { col: 3, row: 0 }, ['W']));

    const { network } = compile(grid);
    expect(network.nodes).toHaveLength(4); // source, valve:a, valve:b, sink
    const valveLink = network.links.find((l) => l.kind === 'valve');
    expect(valveLink).toBeDefined();
    expect(network.links.filter((l) => l.kind === 'pipe')).toHaveLength(2);
  });

  it('closing the valve chokes flow to near zero in the steady solve', () => {
    let grid = emptyGrid(4, 1, 1);
    ({ grid } = place(grid, 'source', { col: 0, row: 0 }, ['E']));
    ({ grid } = place(grid, 'straight', { col: 1, row: 0 }, ['E', 'W']));
    const valvePlacement = place(grid, 'valve', { col: 2, row: 0 }, ['E', 'W']);
    grid = valvePlacement.grid;
    const valveTile = valvePlacement.tile;
    ({ grid } = place(grid, 'sink', { col: 3, row: 0 }, ['W']));
    grid = { ...grid, tiles: grid.tiles.map((t) => (t.id === valveTile.id ? { ...t, opening: 0 } : t)) } as typeof grid;

    const { network } = compile(grid);
    const result = solveSteadyState(network);
    expect(result.converged).toBe(true);
    const valveLink = network.links.find((l) => l.kind === 'valve')!;
    const flow = result.links.get(valveLink.id)!.flow;
    expect(Math.abs(flow)).toBeLessThan(1e-4);
  });
});

describe('grid compiler — branching network solves with mass balance', () => {
  it('conserves flow at a tee feeding two sinks', () => {
    // Horizontal run: source -> straight -> tee -> straight -> sink1.
    // Vertical branch off the tee: straight -> sink2. Every branch carries at
    // least one resistive pipe tile so no branch short-circuits a fixed head
    // directly onto the (unknown) tee head.
    let grid = emptyGrid(5, 4, 3);
    ({ grid } = place(grid, 'source', { col: 0, row: 1 }, ['E']));
    ({ grid } = place(grid, 'straight', { col: 1, row: 1 }, ['E', 'W']));
    ({ grid } = place(grid, 'tee', { col: 2, row: 1 }, ['W', 'E', 'S']));
    ({ grid } = place(grid, 'straight', { col: 3, row: 1 }, ['E', 'W']));
    ({ grid } = place(grid, 'sink', { col: 4, row: 1 }, ['W']));
    ({ grid } = place(grid, 'straight', { col: 2, row: 2 }, ['N', 'S']));
    ({ grid } = place(grid, 'sink', { col: 2, row: 3 }, ['N']));

    const { network, issues } = compile(grid);
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(network.links).toHaveLength(3); // source-tee, tee-sink1, tee-sink2

    const result = solveSteadyState(network);
    expect(result.converged).toBe(true);

    // Mass balance at every junction node: sum of signed flows ~= 0.
    for (const node of network.nodes) {
      if (node.type !== 'junction') continue;
      let net = -(node.demand ?? 0);
      for (const link of network.links) {
        const r = result.links.get(link.id)!;
        if (link.from === node.id) net -= r.flow;
        if (link.to === node.id) net += r.flow;
      }
      expect(Math.abs(net)).toBeLessThan(1e-6);
    }
  });
});

describe('grid compiler — dangling and isolated tiles are excluded, not crashed on', () => {
  it('flags a dangling run and excludes it from the network', () => {
    let grid = emptyGrid(3, 1, 1);
    ({ grid } = place(grid, 'source', { col: 0, row: 0 }, ['E']));
    ({ grid } = place(grid, 'straight', { col: 1, row: 0 }, ['E', 'W']));
    // Nothing placed at (2,0) — the straight tile's east port dangles.

    const { network, issues } = compile(grid);
    expect(network.links).toHaveLength(0);
    expect(network.nodes).toHaveLength(1); // source still gets its node
    expect(issues.some((i) => i.severity === 'warning')).toBe(true);
  });

  it('flags a lone tile with no hub anywhere as isolated', () => {
    let grid = emptyGrid(3, 1, 1);
    ({ grid } = place(grid, 'straight', { col: 1, row: 0 }, ['E', 'W']));

    const { network, issues } = compile(grid);
    expect(network.nodes).toHaveLength(0);
    expect(network.links).toHaveLength(0);
    expect(issues.some((i) => i.message.includes('isolated'))).toBe(true);
  });
});

describe('validateGrid', () => {
  it('reuses the existing network validators on the compiled result', () => {
    let grid = emptyGrid(2, 1, 1);
    ({ grid } = place(grid, 'straight', { col: 0, row: 0 }, ['E', 'W']));
    const issues = validateGrid(grid);
    // No reservoir anywhere in this grid -> validateNetwork's error should surface.
    expect(issues.some((i) => i.severity === 'error')).toBe(true);
  });
});
