import { describe, it, expect } from 'vitest';
import { compile, hxK, strainerK } from './compile';
import { coolingLoop } from './testLoop';
import { updateTile } from './ops';
import { serializeGrid, deserializeGrid } from './serialize';
import { solveSteadyState } from '../physics/steadySolver';
import { pipeGeometry } from '../domain/catalog/pipes';
import { G } from '../domain/units';
import { GRID_PRESETS } from '../examples/gridPresets';
import { HxTile, StrainerTile } from './types';

const solve = (grid: Parameters<typeof compile>[0]) => {
  const c = compile(grid);
  return { c, r: solveSteadyState(c.network) };
};

describe('V2 tiles compile', () => {
  it('compiles the cooling loop with no errors or warnings and solves', () => {
    const { grid } = coolingLoop();
    const { c, r } = solve(grid);
    expect(c.issues).toEqual([]);
    expect(r.converged).toBe(true);
  });

  it('basin is a reservoir at floor elevation + level', () => {
    const { grid, ids } = coolingLoop();
    const { c } = solve(updateTile(grid, ids.basin, { level: 1.7 }));
    const node = c.network.nodes.find((n) => n.id === ids.basin)!;
    expect(node.type).toBe('reservoir');
    expect(node.fixedHead).toBeCloseTo(0 + 1.7, 12);
  });

  it('spray discharges to atmosphere at its own elevation through the nozzle K', () => {
    const { grid, ids } = coolingLoop();
    const { c } = solve(grid);
    expect(c.tileNodes.get(ids.spray)).toEqual([`${ids.spray}:a`, `${ids.spray}:b`]);
    const out = c.network.nodes.find((n) => n.id === `${ids.spray}:b`)!;
    expect(out.type).toBe('reservoir');
    expect(out.fixedHead).toBe(2);
    const link = c.network.links.find((l) => l.id === c.tileLink.get(ids.spray))!;
    expect(link.kind === 'pipe' && link.minorK).toBe(2);
  });

  it('strainer loss = K(clogging)·V²/2g, K = K_clean/(1−c)²', () => {
    const { grid, ids } = coolingLoop();
    const g2 = updateTile(grid, ids.strainer, { clogging: 0.5 });
    const tile = g2.tiles.find((t) => t.id === ids.strainer) as StrainerTile;
    expect(strainerK(tile)).toBeCloseTo(tile.kClean * 4, 12);
    const { c, r } = solve(g2);
    const lr = r.links.get(c.tileLink.get(ids.strainer)!)!;
    // Own length is 0.1 m, so friction is a small add-on to the K loss.
    const kLoss = (strainerK(tile) * lr.velocity ** 2) / (2 * G);
    expect(Math.abs(lr.headLoss)).toBeGreaterThanOrEqual(kLoss * 0.999);
    expect(Math.abs(lr.headLoss)).toBeLessThan(kLoss * 1.05);
  });

  it('hx ΔP = k·Q² through its design point', () => {
    const { grid, ids } = coolingLoop();
    const { c, r } = solve(grid);
    const tile = grid.tiles.find((t) => t.id === ids.hx) as HxTile;
    const lr = r.links.get(c.tileLink.get(ids.hx)!)!;
    const dpExpected = (tile.designDp / tile.designFlow ** 2) * lr.flow ** 2;
    const dpK = (hxK(tile, r.fluid.rho) * r.fluid.rho * lr.velocity ** 2) / 2;
    expect(dpK).toBeCloseTo(dpExpected, 6);
    // Pipe area matches the velocity the solver reports.
    expect(lr.velocity).toBeCloseTo(lr.flow / pipeGeometry(tile.nps, tile.schedule).area, 9);
  });

  it('a stopped pump blocks the line', () => {
    const { grid, ids } = coolingLoop();
    const running = solve(grid).r;
    const stopped = solve(updateTile(grid, ids.pump, { running: false }));
    const q = (res: typeof running, c: ReturnType<typeof compile>) => res.links.get(c.tileLink.get(ids.pump)!)!.flow;
    expect(q(running, compile(grid))).toBeGreaterThan(0.005);
    expect(Math.abs(q(stopped.r, stopped.c))).toBeLessThan(1e-4);
  });

  it('flags a spray that returns to no basin', () => {
    const { grid, ids } = coolingLoop();
    const { c } = solve(updateTile(grid, ids.spray, { returnBasinId: 'NOPE' }));
    expect(c.issues.some((i) => i.ref === ids.spray && /no basin/.test(i.message))).toBe(true);
  });
});

describe('v1 project files migrate to v3 on load', () => {
  // A v1 file is the v3 shape minus everything V2 added.
  const toV1 = (json: string): string => {
    const f = JSON.parse(json);
    f.schemaVersion = 1;
    delete f.grid.instruments;
    for (const t of f.grid.tiles) {
      delete t.tag;
      delete t.service;
      delete t.running;
    }
    return JSON.stringify(f);
  };

  for (const preset of GRID_PRESETS) {
    it(`"${preset.name}" loads from v1 and compiles to the same network`, () => {
      const original = preset.build();
      const loaded = deserializeGrid(toV1(serializeGrid(original)));
      expect(loaded.instruments).toEqual([]);
      const before = compile(original);
      const after = compile(loaded);
      expect(after.issues.filter((i) => /Tag/.test(i.message))).toEqual([]);
      expect(after.network).toEqual(before.network);
      for (const t of loaded.tiles) {
        if (t.kind === 'valve') expect(t.tag).toMatch(/^HV-1\d\d$/);
        if (t.kind === 'pump') expect(t.running).toBe(true);
      }
    });
  }
});
