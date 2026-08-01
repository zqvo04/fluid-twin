import { describe, it, expect } from 'vitest';
import { cellElevation, emptyGrid } from '../grid/types';
import { makeTile, placeTile, updateTile } from '../grid/ops';
import { compile } from '../grid/compile';
import { solveSteadyState } from '../physics/steadySolver';
import { PipelineNetwork } from '../domain/network';
import { buildLinkGeometries, fillPumpVelocities, pointAtFraction } from './linkGeometry';
import {
  buildFlowGraph,
  weightedPick,
  spawnParticle,
  stepParticles,
  rebalanceOccupancy,
  Particle,
  LinkFlow,
  particlePosition,
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

describe('rebalanceOccupancy — population tracks flow, not pipe volume', () => {
  it('thins out an over-occupied low-flow branch back toward its flow-proportional share', () => {
    // A node with two outgoing links: A carries 9x the flow of B. Dwell
    // time alone (the bug being fixed) would let a slow/long branch like B
    // accumulate particles; occupancy should instead settle near the 90/10
    // flow split regardless of where the particles started.
    const network = {
      nodes: [],
      links: [
        { id: 'A', kind: 'pipe', from: 'N', to: 'X' },
        { id: 'B', kind: 'pipe', from: 'N', to: 'Y' },
      ],
    } as unknown as PipelineNetwork;
    const flows = new Map<string, LinkFlow>([
      ['A', { flow: 0.09, velocity: 1 }],
      ['B', { flow: 0.01, velocity: 1 }],
    ]);
    const graph = buildFlowGraph(network, flows);

    // Adversarial start: every particle sits on the low-flow branch B.
    const particles: Particle[] = Array.from({ length: 200 }, () => ({ linkId: 'B', s: 0.5, dir: 1 }));
    const rand = mulberry32(42);

    for (let i = 0; i < 60; i++) rebalanceOccupancy(particles, graph, rand);

    const countA = particles.filter((p) => p.linkId === 'A').length;
    const countB = particles.filter((p) => p.linkId === 'B').length;
    expect(countA + countB).toBe(200); // conserves total count
    // Should have moved decisively toward the 90/10 flow split.
    expect(countA / 200).toBeGreaterThan(0.7);
    expect(countB / 200).toBeLessThan(0.3);
  });

  it('is a no-op on an already flow-proportional population', () => {
    const network = {
      nodes: [],
      links: [
        { id: 'A', kind: 'pipe', from: 'N', to: 'X' },
        { id: 'B', kind: 'pipe', from: 'N', to: 'Y' },
      ],
    } as unknown as PipelineNetwork;
    const flows = new Map<string, LinkFlow>([
      ['A', { flow: 0.05, velocity: 1 }],
      ['B', { flow: 0.05, velocity: 1 }],
    ]);
    const graph = buildFlowGraph(network, flows);
    const particles: Particle[] = [
      ...Array.from({ length: 100 }, (): Particle => ({ linkId: 'A', s: 0.5, dir: 1 })),
      ...Array.from({ length: 100 }, (): Particle => ({ linkId: 'B', s: 0.5, dir: 1 })),
    ];
    const rand = mulberry32(1);
    rebalanceOccupancy(particles, graph, rand);
    expect(particles.filter((p) => p.linkId === 'A').length).toBe(100);
    expect(particles.filter((p) => p.linkId === 'B').length).toBe(100);
  });
});

describe('fillPumpVelocities — pump links get a finite animation velocity', () => {
  function buildInlinePump() {
    // source -> pipe -> pump -> pipe -> sink, all on one row.
    let grid = emptyGrid(9, 1, 1);
    grid = placeTile(grid, makeTile('source', { col: 0, row: 0 }, 0, grid));
    grid = placeTile(grid, makeTile('straight', { col: 1, row: 0 }, 0, grid));
    // Rotation 0 gives a pump ports [W, E] (suction W, discharge E) per ports.ts.
    grid = placeTile(grid, makeTile('pump', { col: 2, row: 0 }, 0, grid));
    grid = placeTile(grid, makeTile('straight', { col: 3, row: 0 }, 0, grid));
    grid = placeTile(grid, makeTile('sink', { col: 4, row: 0 }, 0, grid));
    return grid;
  }

  it('the raw solver result leaves a pump link velocity as NaN', () => {
    const grid = buildInlinePump();
    const compiled = compile(grid);
    const result = solveSteadyState(compiled.network);
    expect(result.converged).toBe(true);
    const pumpTile = grid.tiles.find((t) => t.kind === 'pump')!;
    const pumpLinkId = compiled.tileLink.get(pumpTile.id)!;
    expect(Number.isFinite(result.links.get(pumpLinkId)!.velocity)).toBe(false);
  });

  it('fillPumpVelocities gives the pump link a finite velocity, so particles stop evicting through it', () => {
    const grid = buildInlinePump();
    const compiled = compile(grid);
    const result = solveSteadyState(compiled.network);
    const pumpTile = grid.tiles.find((t) => t.kind === 'pump')!;
    const pumpLinkId = compiled.tileLink.get(pumpTile.id)!;

    const flows = new Map<string, LinkFlow>();
    for (const [id, r] of result.links) flows.set(id, { flow: r.flow, velocity: r.velocity });
    fillPumpVelocities(grid, compiled, flows);

    const pumpFlow = flows.get(pumpLinkId)!;
    expect(Number.isFinite(pumpFlow.velocity)).toBe(true);
    expect(Math.abs(pumpFlow.velocity)).toBeGreaterThan(0);

    // With a finite velocity, a particle placed mid-link should advance
    // and eventually hand off — not get discarded every single step (the
    // pre-fix NaN branch in stepParticles respawns unconditionally).
    const graph = buildFlowGraph(compiled.network, flows);
    const geometries = buildLinkGeometries(grid, compiled);
    const rand = mulberry32(3);
    const particle: Particle = { linkId: pumpLinkId, s: 0.1, dir: 1 };
    const before = particle.s;
    stepParticles([particle], geometries, graph, flows, 0.05, rand);
    // It moved along the SAME link instead of being replaced elsewhere.
    expect(particle.linkId).toBe(pumpLinkId);
    expect(particle.s).toBeGreaterThan(before);
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
