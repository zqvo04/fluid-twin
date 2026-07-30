import { describe, it, expect } from 'vitest';
import { cellElevation, emptyGrid } from '../grid/types';
import { makeTile, placeTile, updateTile, DEFAULT_TILE_DEFAULTS } from '../grid/ops';
import { compile } from '../grid/compile';
import { solveSteadyState } from '../physics/steadySolver';
import { PipelineNetwork } from '../domain/network';
import { buildLinkGeometries, pointAtFraction, LinkGeometry } from './linkGeometry';
import { linkOpenFraction } from './flowProfile';
import {
  buildFlowGraph,
  weightedPick,
  spawnParticle,
  stepParticles,
  seedParticles,
  particleBudget,
  Particle,
  LinkFlow,
  particlePosition,
  particleCellsPerSecond,
  particleView,
} from './particles';

/** Deterministic PRNG (mulberry32) so the statistical test is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildBranchingNetwork() {
  // source -> straight -> tee -> { straight -> sink1 (short, low resistance),
  //                                straight x3 -> sink2 (long, high resistance) }
  // Both sinks are pinned to the same fixed head (overriding sink2's
  // elevation-based default) and the source is given an explicit head above
  // both, so the split is driven purely by the branches' resistance
  // difference, not by an incidental elevation difference between them.
  let grid = emptyGrid(5, 6, 2);
  const source = makeTile('source', { col: 0, row: 1 }, 0, grid);
  grid = placeTile(grid, source);
  grid = placeTile(grid, makeTile('straight', { col: 1, row: 1 }, 0, grid));
  grid = placeTile(grid, makeTile('tee', { col: 2, row: 1 }, 0, grid));
  grid = placeTile(grid, makeTile('straight', { col: 3, row: 1 }, 0, grid));
  const sink1 = makeTile('sink', { col: 4, row: 1 }, 0, grid);
  grid = placeTile(grid, sink1);
  grid = placeTile(grid, makeTile('straight', { col: 2, row: 2 }, 90, grid));
  grid = placeTile(grid, makeTile('straight', { col: 2, row: 3 }, 90, grid));
  grid = placeTile(grid, makeTile('straight', { col: 2, row: 4 }, 90, grid));
  const sink2 = makeTile('sink', { col: 2, row: 5 }, 90, grid);
  grid = placeTile(grid, sink2);

  const commonHead = cellElevation(grid, { col: 0, row: 1 });
  grid = updateTile(grid, sink1.id, { head: commonHead });
  grid = updateTile(grid, sink2.id, { head: commonHead });
  grid = updateTile(grid, source.id, { head: commonHead + 4 });
  return grid;
}

describe('flow particles — branch handoff matches the solved flow split', () => {
  it('picks each outgoing branch at a tee with probability proportional to its flow', () => {
    const grid = buildBranchingNetwork();
    const { network, tileNodes, issues } = compile(grid);
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);

    const result = solveSteadyState(network);
    expect(result.converged).toBe(true);

    const flows = new Map<string, LinkFlow>();
    for (const [id, r] of result.links) flows.set(id, { flow: r.flow, velocity: r.velocity });

    const graph = buildFlowGraph(network, flows);
    const teeTile = grid.tiles.find((t) => t.kind === 'tee')!;
    const teeNodeId = tileNodes.get(teeTile.id)![0];
    const choices = graph.outgoing.get(teeNodeId)!;
    expect(choices).toHaveLength(2);

    const totalWeight = choices[0].weight + choices[1].weight;
    const expectedRatio = choices[0].weight / totalWeight;
    // The short branch should carry more flow than the long one.
    expect(expectedRatio).toBeGreaterThan(0.5);

    const rand = mulberry32(20260729);
    const N = 8000;
    let count0 = 0;
    for (let i = 0; i < N; i++) {
      const picked = weightedPick(choices, rand());
      if (picked === choices[0]) count0++;
    }
    const empiricalRatio = count0 / N;
    expect(Math.abs(empiricalRatio - expectedRatio)).toBeLessThan(0.05);
  });

  it('advances a particle along a link and hands it off at the end without leaking NaN positions', () => {
    const grid = buildBranchingNetwork();
    const compiled = compile(grid);
    const result = solveSteadyState(compiled.network);
    const flows = new Map<string, LinkFlow>();
    for (const [id, r] of result.links) flows.set(id, { flow: r.flow, velocity: r.velocity });

    const graph = buildFlowGraph(compiled.network, flows);
    const geometries = buildLinkGeometries(grid, compiled);
    const rand = mulberry32(7);

    const particles = [];
    for (let i = 0; i < 50; i++) {
      const p = spawnParticle(graph, rand);
      if (p) particles.push(p);
    }
    expect(particles.length).toBeGreaterThan(0);

    for (let step = 0; step < 500; step++) {
      stepParticles(particles, geometries, graph, flows, 0.05, rand);
    }

    for (const p of particles) {
      const pos = particlePosition(p, geometries);
      expect(pos).not.toBeNull();
      expect(Number.isFinite(pos!.col)).toBe(true);
      expect(Number.isFinite(pos!.row)).toBe(true);
      expect(p.s).toBeGreaterThanOrEqual(-1e-6);
      expect(p.s).toBeLessThanOrEqual(1 + 1e-6);
    }
  });
});

describe('particle density along the network', () => {
  /** Two links in series, one cell and three cells long, same bore and flow. */
  function series() {
    const network = {
      nodes: [],
      links: [
        { id: 'SHORT', kind: 'pipe', from: 'N0', to: 'N1' },
        { id: 'LONG', kind: 'pipe', from: 'N1', to: 'N2' },
      ],
    } as unknown as PipelineNetwork;
    const flows = new Map<string, LinkFlow>([
      ['SHORT', { flow: 0.01, velocity: 1 }],
      ['LONG', { flow: 0.01, velocity: 1 }],
    ]);
    const geometries = new Map<string, LinkGeometry>([
      ['SHORT', { points: [{ col: 0, row: 0 }, { col: 1, row: 0 }], cellLength: 1 }],
      ['LONG', { points: [{ col: 1, row: 0 }, { col: 4, row: 0 }], cellLength: 3 }],
    ]);
    return { graph: buildFlowGraph(network, flows), flows, geometries };
  }

  it('seeds even linear density, not an even count per link', () => {
    // Fluid fills a pipe by volume: a three-cell run holds three times what a
    // one-cell run holds, at the same spacing. Spacing is not what carries the
    // flow rate — speed and brightness are.
    const { graph, geometries } = series();
    const particles = seedParticles(graph, geometries, 4000, mulberry32(3));
    const shortCount = particles.filter((p) => p.linkId === 'SHORT').length;
    const longCount = particles.filter((p) => p.linkId === 'LONG').length;
    expect(particles).toHaveLength(4000);
    expect(longCount / shortCount).toBeGreaterThan(2.6);
    expect(longCount / shortCount).toBeLessThan(3.4);
  });

  it('spreads particles along each link rather than bunching them at one end', () => {
    const { graph, geometries } = series();
    const particles = seedParticles(graph, geometries, 3000, mulberry32(8));
    const onLong = particles.filter((p) => p.linkId === 'LONG');
    const firstHalf = onLong.filter((p) => p.s < 0.5).length / onLong.length;
    expect(firstHalf).toBeGreaterThan(0.42);
    expect(firstHalf).toBeLessThan(0.58);
  });

  it('sizes the pool by how much pipe there is, so density does not thin out on a big network', () => {
    const run = (cells: number) =>
      new Map<string, LinkGeometry>([
        ['A', { points: [{ col: 0, row: 0 }, { col: cells, row: 0 }], cellLength: cells }],
      ]);
    // Both comfortably clear of the floor and the cap, so this compares the
    // density rule itself rather than a clamp.
    expect(particleBudget(run(100))).toBeGreaterThan(particleBudget(run(20)));
    expect(particleBudget(run(100)) / 100).toBeCloseTo(particleBudget(run(20)) / 20, 5);
  });

  it('holds the budget between sane bounds', () => {
    const tiny = new Map<string, LinkGeometry>([
      ['A', { points: [{ col: 0, row: 0 }, { col: 0.1, row: 0 }], cellLength: 0.1 }],
    ]);
    const huge = new Map<string, LinkGeometry>([
      ['A', { points: [{ col: 0, row: 0 }, { col: 9999, row: 0 }], cellLength: 9999 }],
    ]);
    expect(particleBudget(tiny)).toBe(40);
    expect(particleBudget(huge)).toBe(1600);
  });
});

describe('throttling a valve — what the particle field actually shows', () => {
  /** source - straight - valve - straight x2 - sink, on one level. */
  function valveLine(opening: number) {
    let grid = emptyGrid(7, 3, 2);
    const source = makeTile('source', { col: 0, row: 1 }, 0, grid);
    grid = placeTile(grid, source);
    grid = placeTile(grid, makeTile('straight', { col: 1, row: 1 }, 0, grid));
    // A globe valve: the equal-percentage device actually used for
    // throttling. (A gate valve is quick-opening — an on/off device that
    // still passes 39% of its area at 15% travel.)
    const valve = makeTile('valve', { col: 2, row: 1 }, 0, grid, {
      ...DEFAULT_TILE_DEFAULTS,
      valveType: 'globe',
    });
    grid = placeTile(grid, valve);
    grid = placeTile(grid, makeTile('straight', { col: 3, row: 1 }, 0, grid));
    grid = placeTile(grid, makeTile('straight', { col: 4, row: 1 }, 0, grid));
    const sink = makeTile('sink', { col: 5, row: 1 }, 0, grid);
    grid = placeTile(grid, sink);
    grid = updateTile(grid, source.id, { head: cellElevation(grid, { col: 0, row: 1 }) + 6 });
    grid = updateTile(grid, valve.id, { opening });

    const compiled = compile(grid);
    const result = solveSteadyState(compiled.network);
    const flows = new Map<string, LinkFlow>();
    for (const link of compiled.network.links) {
      const r = result.links.get(link.id)!;
      flows.set(link.id, { flow: r.flow, velocity: r.velocity, openFraction: linkOpenFraction(link) });
    }
    const valveLinkId = compiled.tileLink.get(valve.id)!;
    const pipeLinkId = [...flows.keys()].find((id) => id !== valveLinkId)!;
    return { grid, compiled, flows, valveLinkId, pipeLinkId };
  }

  /** Speed [cells/s] of a centreline particle at position `s` on a link. */
  function speedAt(flows: Map<string, LinkFlow>, linkId: string, s: number, cellSize: number) {
    const p: Particle = { linkId, s, dir: 1, u: 0, age: 1 };
    return particleCellsPerSecond(p, flows.get(linkId)!, cellSize);
  }

  it('a throttled valve is the fastest point in the line, not the slowest', () => {
    const { grid, flows, valveLinkId, pipeLinkId } = valveLine(0.25);
    const throat = speedAt(flows, valveLinkId, 0.5, grid.cellSize);
    const pipe = speedAt(flows, pipeLinkId, 0.5, grid.cellSize);
    expect(throat).toBeGreaterThanOrEqual(pipe * 2);
  });

  it('closing the valve slows the pipes but keeps the jet through the gap quick', () => {
    const open = valveLine(1);
    const shut = valveLine(0.15);

    const pipeOpen = speedAt(open.flows, open.pipeLinkId, 0.5, open.grid.cellSize);
    const pipeShut = speedAt(shut.flows, shut.pipeLinkId, 0.5, shut.grid.cellSize);
    const jetOpen = speedAt(open.flows, open.valveLinkId, 0.5, open.grid.cellSize);
    const jetShut = speedAt(shut.flows, shut.valveLinkId, 0.5, shut.grid.cellSize);

    // The line as a whole slows right down...
    expect(pipeShut).toBeLessThan(pipeOpen / 2);
    // ...while the gap itself does not, because the same flow squeezes through
    // a much smaller area. That contrast is the point.
    expect(jetShut / pipeShut).toBeGreaterThan(4 * (jetOpen / pipeOpen));
  });

  it('a wide-open valve animates at the same pace as the pipe next to it', () => {
    const { grid, flows, valveLinkId, pipeLinkId } = valveLine(1);
    const throat = speedAt(flows, valveLinkId, 0.5, grid.cellSize);
    const pipe = speedAt(flows, pipeLinkId, 0.5, grid.cellSize);
    expect(throat).toBeCloseTo(pipe, 6);
  });

  it('draws the stream as a narrow thread through a throttled gap and full bore elsewhere', () => {
    const { grid, compiled, flows, valveLinkId } = valveLine(0.15);
    const geometries = buildLinkGeometries(grid, compiled);
    const atWall: Particle = { linkId: valveLinkId, s: 0.5, dir: 1, u: 1, age: 1 };
    const atEntry: Particle = { linkId: valveLinkId, s: 0, dir: 1, u: 1, age: 1 };

    const throat = particleView(atWall, geometries, flows)!;
    const entry = particleView(atEntry, geometries, flows)!;
    expect(Math.abs(entry.offset)).toBeCloseTo(1, 6); // full bore on the way in
    expect(Math.abs(throat.offset)).toBeLessThan(0.5);
  });
});

describe('particle motion', () => {
  it('carries leftover distance across a handoff instead of dropping it', () => {
    // Two links in series, both one cell long, flow left to right. A step big
    // enough to cross the first and part of the second must actually end up
    // inside the second — not parked at the junction.
    const network = {
      nodes: [],
      links: [
        { id: 'A', kind: 'pipe', from: 'N0', to: 'N1' },
        { id: 'B', kind: 'pipe', from: 'N1', to: 'N2' },
      ],
    } as unknown as PipelineNetwork;
    const flows = new Map<string, LinkFlow>([
      ['A', { flow: 0.01, velocity: 1 }],
      ['B', { flow: 0.01, velocity: 1 }],
    ]);
    const geometries = new Map<string, LinkGeometry>([
      ['A', { points: [{ col: 0, row: 0 }, { col: 1, row: 0 }], cellLength: 1 }],
      ['B', { points: [{ col: 1, row: 0 }, { col: 2, row: 0 }], cellLength: 1 }],
    ]);
    const graph = buildFlowGraph(network, flows);

    const start: Particle = { linkId: 'A', s: 0, dir: 1, u: 0, age: 1 };
    const cellSize = 1 / 1.5;
    // The centreline runs faster than bulk (velocity profile), so the exact
    // distance comes from the same function the stepper uses.
    const cells = particleCellsPerSecond(start, flows.get('A')!, cellSize);
    expect(cells).toBeGreaterThan(1); // long enough to cross link A entirely

    const particles: Particle[] = [start];
    stepParticles(particles, geometries, graph, flows, 1, () => 0.5, cellSize);

    expect(particles[0].linkId).toBe('B');
    expect(particles[0].s).toBeCloseTo(cells - 1, 6);
  });

  it('times every link kind off the board, so a valve does not animate at twice the pipe rate', () => {
    // Same solved velocity on a valve and on a pipe of the same drawn length
    // must give the same screen speed; the old physicalLength floor made the
    // valve twice as fast for no physical reason.
    const flows = new Map<string, LinkFlow>([
      ['PIPE', { flow: 0.01, velocity: 2 }],
      ['VALVE', { flow: 0.01, velocity: 2, openFraction: 1 }],
    ]);
    const p: Particle = { linkId: 'PIPE', s: 0.5, dir: 1, u: 0, age: 1 };
    const v: Particle = { linkId: 'VALVE', s: 0.5, dir: 1, u: 0, age: 1 };
    expect(particleCellsPerSecond(p, flows.get('PIPE')!, 2)).toBeCloseTo(
      particleCellsPerSecond(v, flows.get('VALVE')!, 2),
      9,
    );
  });

  it('fades a particle in rather than popping it into existence', () => {
    const geometries = new Map<string, LinkGeometry>([
      ['A', { points: [{ col: 0, row: 0 }, { col: 1, row: 0 }], cellLength: 1 }],
    ]);
    const flows = new Map<string, LinkFlow>([['A', { flow: 0.01, velocity: 1 }]]);
    const fresh: Particle = { linkId: 'A', s: 0.5, dir: 1, u: 0, age: 0 };
    const settled: Particle = { linkId: 'A', s: 0.5, dir: 1, u: 0, age: 10 };
    expect(particleView(fresh, geometries, flows)!.fade).toBe(0);
    expect(particleView(settled, geometries, flows)!.fade).toBe(1);
  });
});

describe('pointAtFraction', () => {
  it('interpolates linearly along a two-point polyline', () => {
    const pts = [
      { col: 0, row: 0 },
      { col: 4, row: 0 },
    ];
    expect(pointAtFraction(pts, 0.5)).toEqual({ col: 2, row: 0 });
    expect(pointAtFraction(pts, 0)).toEqual({ col: 0, row: 0 });
    expect(pointAtFraction(pts, 1)).toEqual({ col: 4, row: 0 });
  });

  it('walks through an intermediate waypoint on a bent polyline', () => {
    const pts = [
      { col: 0, row: 0 },
      { col: 2, row: 0 },
      { col: 2, row: 2 },
    ];
    // Total length 4; fraction 0.25 -> arc length 1 -> still on first segment.
    expect(pointAtFraction(pts, 0.25)).toEqual({ col: 1, row: 0 });
    // fraction 0.75 -> arc length 3 -> 1 unit into the second segment.
    expect(pointAtFraction(pts, 0.75)).toEqual({ col: 2, row: 1 });
  });
});
