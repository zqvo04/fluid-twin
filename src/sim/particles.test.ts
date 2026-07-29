import { describe, it, expect } from 'vitest';
import { emptyGrid } from '../grid/types';
import { makeTile, placeTile } from '../grid/ops';
import { compile } from '../grid/compile';
import { solveSteadyState } from '../physics/steadySolver';
import { buildLinkGeometries, pointAtFraction } from './linkGeometry';
import { buildFlowGraph, weightedPick, spawnParticle, stepParticles, LinkFlow, particlePosition } from './particles';

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
  let grid = emptyGrid(5, 6, 2);
  grid = placeTile(grid, makeTile('source', { col: 0, row: 1 }, 0, grid));
  grid = placeTile(grid, makeTile('straight', { col: 1, row: 1 }, 0, grid));
  grid = placeTile(grid, makeTile('tee', { col: 2, row: 1 }, 0, grid));
  grid = placeTile(grid, makeTile('straight', { col: 3, row: 1 }, 0, grid));
  grid = placeTile(grid, makeTile('sink', { col: 4, row: 1 }, 0, grid));
  grid = placeTile(grid, makeTile('straight', { col: 2, row: 2 }, 90, grid));
  grid = placeTile(grid, makeTile('straight', { col: 2, row: 3 }, 90, grid));
  grid = placeTile(grid, makeTile('straight', { col: 2, row: 4 }, 90, grid));
  grid = placeTile(grid, makeTile('sink', { col: 2, row: 5 }, 90, grid));
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
