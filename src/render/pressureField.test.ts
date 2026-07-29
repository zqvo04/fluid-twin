import { describe, it, expect } from 'vitest';
import { emptyGrid, Direction, Rotation, TileKind, GridModel } from '../grid/types';
import { makeTile, placeTile } from '../grid/ops';
import { tilePorts } from '../grid/ports';
import { compile } from '../grid/compile';
import { computePressureField, tilePressure } from './pressureField';
import { waterProperties } from '../domain/fluid';
import { headToPressure } from '../domain/units';

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
  const tile = makeTile(kind, cell, rot, grid);
  return { grid: placeTile(grid, tile), tile };
}

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

    const p1 = tilePressure(s1.id, grid, compiled, field)!;
    const p2 = tilePressure(s2.id, grid, compiled, field)!;
    // The run is source -> s1 -> s2 -> sink; s1 sits closer to the high-head
    // source end, so its interpolated pressure should exceed s2's.
    expect(p1.pa).toBeGreaterThan(p2.pa);

    expect(tilePressure('NOPE', grid, compiled, field)).toBeNull();
  });

  it('an elbow reads as a hot spot: hotter than the straight tile right after it', () => {
    // A realistically long run (small per-cell head gradient, like an actual
    // pipe run) with one elbow partway through, turning up to the sink.
    // source(0,2) -> straight x3 -> elbow -> straight(up leg) -> sink(4,0).
    // The tile-level model attributes the elbow's own fitting loss to what
    // comes *after* it (its entry pressure is unaffected by its own loss,
    // like any other tile's), so the elbow reads hot and the drop lands on
    // the immediately following tile — a "pressure crashes right past the
    // bend" pattern that's a reasonable, legible stand-in for the real
    // localized turbulence/impingement loss a 90-degree turn causes.
    let grid = emptyGrid(6, 4, 1);
    ({ grid } = place(grid, 'source', { col: 0, row: 2 }, ['E']));
    ({ grid } = place(grid, 'straight', { col: 1, row: 2 }, ['E', 'W']));
    ({ grid } = place(grid, 'straight', { col: 2, row: 2 }, ['E', 'W']));
    ({ grid } = place(grid, 'straight', { col: 3, row: 2 }, ['E', 'W']));
    const elbowPlacement = place(grid, 'elbow', { col: 4, row: 2 }, ['W', 'N']);
    grid = elbowPlacement.grid;
    const elbow = elbowPlacement.tile;
    const afterElbow = place(grid, 'straight', { col: 4, row: 1 }, ['N', 'S']);
    grid = afterElbow.grid;
    ({ grid } = place(grid, 'sink', { col: 4, row: 0 }, ['S']));
    const compiled = compile(grid);

    const source = compiled.network.nodes.find((n) => n.id.startsWith('SRC'))!;
    const sink = compiled.network.nodes.find((n) => n.id.startsWith('SNK'))!;
    const heads = new Map([
      [source.id, 12],
      [sink.id, 10],
    ]);
    const pipeLink = compiled.network.links.find((l) => l.kind === 'pipe')!;
    const links = new Map([[pipeLink.id, { flow: 0.01, velocity: 2 }]]);
    const field = computePressureField(grid, compiled, heads, links);

    const pElbow = tilePressure(elbow.id, grid, compiled, field)!;
    const pAfter = tilePressure(afterElbow.tile.id, grid, compiled, field)!;

    // Static pressure still falls moving downstream through the elbow — it's
    // the wall-load/color value (t) that should read hotter.
    expect(pElbow.pa).toBeGreaterThan(pAfter.pa);
    expect(pElbow.t).toBeGreaterThan(pAfter.t);
  });

  it('a throttled valve renders its upstream/downstream sides distinctly instead of averaging them away', () => {
    let grid = emptyGrid(4, 1, 1);
    grid = placeTile(grid, makeTile('source', { col: 0, row: 0 }, 0, grid));
    const valve = makeTile('valve', { col: 1, row: 0 }, 0, grid);
    grid = placeTile(grid, { ...valve, opening: 0.15 } as typeof valve);
    grid = placeTile(grid, makeTile('straight', { col: 2, row: 0 }, 0, grid));
    grid = placeTile(grid, makeTile('sink', { col: 3, row: 0 }, 0, grid));
    const compiled = compile(grid);

    const nodeIds = compiled.tileNodes.get(valve.id)!;
    const valveLink = compiled.network.links.find((l) => l.kind === 'valve')!;
    const heads = new Map([
      [nodeIds[0], 30], // upstream side: most of the drop hasn't happened yet
      [nodeIds[1], 12], // downstream side: already through the restriction
    ]);
    const links = new Map([[valveLink.id, { flow: 0.005, velocity: 1.5 }]]);
    const field = computePressureField(grid, compiled, heads, links);

    const p = tilePressure(valve.id, grid, compiled, field)!;
    expect(p.perPort).toBeDefined();
    const values = Object.values(p.perPort!);
    expect(values).toHaveLength(2);
    // The two sides must differ — averaging them away is exactly the bug
    // being fixed (a throttled valve used to read as one neutral color).
    expect(Math.abs(values[0]! - values[1]!)).toBeGreaterThan(0.1);
  });
});
