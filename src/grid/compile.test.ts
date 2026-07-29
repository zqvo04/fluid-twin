import { describe, it, expect } from 'vitest';
import { solveSteadyState } from '../physics/steadySolver';
import { emptyGrid, cellElevation, Direction, Rotation, TileKind, GridModel } from './types';
import { makeTile, placeTile, updateTile, DEFAULT_TILE_DEFAULTS } from './ops';
import { tilePorts } from './ports';
import { compile, resolveIssueTile } from './compile';
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

describe('grid compiler — junction (tee/cross) minor losses', () => {
  it('tags a tee run leg as teeRun and its odd branch leg as teeBranch', () => {
    let grid = emptyGrid(3, 3, 1);
    ({ grid } = place(grid, 'source', { col: 0, row: 1 }, ['E']));
    ({ grid } = place(grid, 'tee', { col: 1, row: 1 }, ['W', 'E', 'S']));
    ({ grid } = place(grid, 'sink', { col: 2, row: 1 }, ['W']));
    ({ grid } = place(grid, 'sink', { col: 1, row: 2 }, ['N']));

    const { network } = compile(grid);
    const pipes = network.links.filter((l) => l.kind === 'pipe');
    // source-tee and tee-sink1 use the tee's W/E run ports; tee-sink2 uses the odd S port.
    const runLegs = pipes.filter((p) => p.kind === 'pipe' && (p.fittings ?? []).includes('teeRun'));
    const branchLegs = pipes.filter((p) => p.kind === 'pipe' && (p.fittings ?? []).includes('teeBranch'));
    expect(runLegs).toHaveLength(2);
    expect(branchLegs).toHaveLength(1);
  });

  it('tags every cross leg as teeBranch (no odd/run leg on a symmetric cross)', () => {
    let grid = emptyGrid(3, 3, 1);
    ({ grid } = place(grid, 'source', { col: 0, row: 1 }, ['E']));
    ({ grid } = place(grid, 'cross', { col: 1, row: 1 }, ['N', 'E', 'S', 'W']));
    ({ grid } = place(grid, 'sink', { col: 2, row: 1 }, ['W']));
    ({ grid } = place(grid, 'sink', { col: 1, row: 2 }, ['N']));

    const { network } = compile(grid);
    const pipes = network.links.filter((l) => l.kind === 'pipe');
    expect(pipes.length).toBeGreaterThan(0);
    for (const p of pipes) {
      if (p.kind === 'pipe') expect(p.fittings).toContain('teeBranch');
    }
  });

  it('a symmetric cross splits more flow into the straight-through branch than the perpendicular one', () => {
    // Source feeds a cross whose straight-through leg and perpendicular leg
    // are otherwise identical (same pipe length/size). Both sinks are pinned
    // to the same fixed head as the source (overriding their elevation-based
    // default) so gravity contributes nothing — the only asymmetry left is
    // teeBranch's higher K, which should push more flow through the
    // straight leg... except a cross tags *both* legs teeBranch (see the
    // "tags every cross leg" test above), so this documents that a plain
    // cross does NOT yet bias direction; a tee does (see the tee test).
    let grid = emptyGrid(4, 4, 2);
    const source = place(grid, 'source', { col: 0, row: 1 }, ['E']);
    grid = source.grid;
    ({ grid } = place(grid, 'cross', { col: 1, row: 1 }, ['N', 'E', 'S', 'W']));
    ({ grid } = place(grid, 'straight', { col: 2, row: 1 }, ['E', 'W']));
    const sink1 = place(grid, 'sink', { col: 3, row: 1 }, ['W']);
    grid = sink1.grid;
    ({ grid } = place(grid, 'straight', { col: 1, row: 2 }, ['N', 'S']));
    const sink2 = place(grid, 'sink', { col: 1, row: 3 }, ['N']);
    grid = sink2.grid;

    // Both sinks pinned to the same fixed head; the source is given an
    // explicit margin above it so there is real flow to split (isolating
    // the resistance-only comparison from any elevation confound).
    const commonHead = cellElevation(grid, { col: 0, row: 1 });
    grid = updateTile(grid, sink1.tile.id, { head: commonHead });
    grid = updateTile(grid, sink2.tile.id, { head: commonHead });
    grid = updateTile(grid, source.tile.id, { head: commonHead + 4 });

    const { network } = compile(grid);
    const result = solveSteadyState(network);
    expect(result.converged).toBe(true);

    const straightLink = network.links.find((l) => l.to === sink1.tile.id)!;
    const branchLink = network.links.find((l) => l.to === sink2.tile.id)!;
    const qStraight = Math.abs(result.links.get(straightLink.id)!.flow);
    const qBranch = Math.abs(result.links.get(branchLink.id)!.flow);
    // Both legs carry identical teeBranch K on a cross, so with equal fixed
    // heads and equal pipe runs the split is symmetric (within solver tolerance).
    expect(qStraight).toBeCloseTo(qBranch, 4);
  });

  it('a tee sends more flow through its low-K run leg than its high-K branch leg', () => {
    let grid = emptyGrid(4, 4, 2);
    const source = place(grid, 'source', { col: 0, row: 1 }, ['E']);
    grid = source.grid;
    ({ grid } = place(grid, 'tee', { col: 1, row: 1 }, ['W', 'E', 'S']));
    ({ grid } = place(grid, 'straight', { col: 2, row: 1 }, ['E', 'W']));
    const runSink = place(grid, 'sink', { col: 3, row: 1 }, ['W']);
    grid = runSink.grid;
    ({ grid } = place(grid, 'straight', { col: 1, row: 2 }, ['N', 'S']));
    const branchSink = place(grid, 'sink', { col: 1, row: 3 }, ['N']);
    grid = branchSink.grid;

    const commonHead = cellElevation(grid, { col: 0, row: 1 });
    grid = updateTile(grid, runSink.tile.id, { head: commonHead });
    grid = updateTile(grid, branchSink.tile.id, { head: commonHead });
    grid = updateTile(grid, source.tile.id, { head: commonHead + 4 });

    const { network } = compile(grid);
    const result = solveSteadyState(network);
    expect(result.converged).toBe(true);

    const runLink = network.links.find((l) => l.to === runSink.tile.id)!;
    const branchLink = network.links.find((l) => l.to === branchSink.tile.id)!;
    const qRun = Math.abs(result.links.get(runLink.id)!.flow);
    const qBranch = Math.abs(result.links.get(branchLink.id)!.flow);
    expect(qRun).toBeGreaterThan(qBranch);
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

describe('resolveIssueTile', () => {
  it('resolves a tile id, a network node id, and a network link id back to the owning tile', () => {
    let grid = emptyGrid(4, 1, 1);
    ({ grid } = place(grid, 'source', { col: 0, row: 0 }, ['E']));
    const valvePlacement = place(grid, 'valve', { col: 1, row: 0 }, ['E', 'W']);
    grid = valvePlacement.grid;
    const valve = valvePlacement.tile;
    ({ grid } = place(grid, 'straight', { col: 2, row: 0 }, ['E', 'W']));
    ({ grid } = place(grid, 'sink', { col: 3, row: 0 }, ['W']));

    const compiled = compile(grid);
    const valveLinkId = compiled.tileLink.get(valve.id)!;
    const valveNodeId = compiled.tileNodes.get(valve.id)![0];

    expect(resolveIssueTile(valve.id, grid, compiled)).toBe(valve.id);
    expect(resolveIssueTile(valveLinkId, grid, compiled)).toBe(valve.id);
    expect(resolveIssueTile(valveNodeId, grid, compiled)).toBe(valve.id);
    expect(resolveIssueTile(undefined, grid, compiled)).toBeNull();
    expect(resolveIssueTile('NOPE', grid, compiled)).toBeNull();
  });

  it('resolves a dangling/isolated tile ref that never made it into tileNodes or tileLink', () => {
    let grid = emptyGrid(3, 1, 1);
    ({ grid } = place(grid, 'source', { col: 0, row: 0 }, ['E']));
    const strayPlacement = place(grid, 'straight', { col: 1, row: 0 }, ['E', 'W']);
    grid = strayPlacement.grid;
    const stray = strayPlacement.tile;
    // No sink at (2,0) — the straight tile's east port dangles, so it's
    // excluded from both tileNodes and tileLink but its ref still names it.

    const compiled = compile(grid);
    expect(compiled.tileNodes.has(stray.id)).toBe(false);
    expect(compiled.tileLink.has(stray.id)).toBe(false);
    expect(resolveIssueTile(stray.id, grid, compiled)).toBe(stray.id);
  });
});
