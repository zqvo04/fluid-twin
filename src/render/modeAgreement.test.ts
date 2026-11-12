/**
 * §1.2 rule 4 — the two modes cannot disagree: for any model, the PFD and map
 * render lists hold the same element ids at the same cells, and every number
 * either shows equals elementReadout(id).
 */

import { describe, it, expect } from 'vitest';
import { buildPfdList } from './pfdLayer';
import { buildMapList } from './mapLayer';
import { RenderItem, ValueKey } from './renderList';
import { compile } from '../grid/compile';
import { makeTile, placeTile, updateTile } from '../grid/ops';
import { nextTag } from '../grid/tags';
import { emptyGrid, GridModel, InstrumentType, Rotation, TileKind } from '../grid/types';
import { solveSteadyState } from '../physics/steadySolver';
import { Readout, SolvedState, elementReadout } from '../readouts';

/** Every way the two lists can disagree with each other or with readouts. */
function modeAgreement(pfd: RenderItem[], map: RenderItem[], readout: (id: string) => Readout | null): string[] {
  const errors: string[] = [];
  const ids = (l: RenderItem[]) => l.map((i) => i.id).sort();
  const [a, b] = [ids(pfd), ids(map)];
  if (new Set(a).size !== a.length || new Set(b).size !== b.length) errors.push('duplicate id in a list');
  if (a.join('|') !== b.join('|')) errors.push(`id sets differ: pfd ${a.length} vs map ${b.length}`);
  const mapById = new Map(map.map((i) => [i.id, i]));
  for (const p of pfd) {
    const m = mapById.get(p.id);
    if (m && (m.cell.col !== p.cell.col || m.cell.row !== p.cell.row)) errors.push(`${p.id}: cell differs`);
  }
  for (const [mode, list] of [['pfd', pfd], ['map', map]] as const) {
    for (const item of list) {
      const r = readout(item.id);
      if (!r) {
        errors.push(`${mode} ${item.id}: no readout`);
        continue;
      }
      for (const k of Object.keys(item.values) as ValueKey[]) {
        if (!Object.is(item.values[k], r[k])) errors.push(`${mode} ${item.id}.${k}: ${item.values[k]} ≠ readout ${r[k]}`);
      }
    }
  }
  return errors;
}

/** Deterministic PRNG (mulberry32) so a failure reproduces from its seed. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KINDS: TileKind[] = ['straight', 'elbow', 'tee', 'cross', 'valve', 'pump', 'source', 'sink', 'basin', 'strainer', 'hx', 'spray'];
const INSTRUMENTS: InstrumentType[] = ['FI', 'PI', 'LI', 'FIC'];

function randomModel(seed: number): GridModel {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  let g = emptyGrid(3 + Math.floor(r() * 6), 3 + Math.floor(r() * 5), 0.5 + r() * 2);
  for (let row = 0; row < g.rows; row++) {
    for (let col = 0; col < g.cols; col++) {
      if (r() < 0.45) continue;
      g = placeTile(g, makeTile(pick(KINDS), { col, row }, pick([0, 90, 180, 270] as Rotation[]), g));
    }
  }
  for (const t of g.tiles) {
    if (t.kind === 'valve' && r() < 0.5) g = updateTile(g, t.id, { service: 'control', opening: r() });
    if (t.kind === 'pump' && r() < 0.3) g = updateTile(g, t.id, { running: false });
    if ((t.kind === 'source' || t.kind === 'sink') && r() < 0.5) g = updateTile(g, t.id, { head: r() * 30 });
  }
  const nInst = Math.floor(r() * 5);
  for (let i = 0; i < nInst; i++) {
    const type = pick(INSTRUMENTS);
    // Mostly real targets; sometimes a dangling one, which both modes must still list.
    const targetId = g.tiles.length && r() < 0.85 ? pick(g.tiles).id : 'GONE';
    g = { ...g, instruments: [...g.instruments, { tag: nextTag(g, type), type, targetId }] };
  }
  return g;
}

function lists(g: GridModel) {
  const compiled = compile(g);
  let result: SolvedState | null = null;
  try {
    result = solveSteadyState(compiled.network);
  } catch {
    result = null; // ill-posed random networks: the unsolved path is checked too
  }
  return {
    pfd: buildPfdList(g, compiled, result).items,
    map: buildMapList(g, compiled, result),
    readout: (id: string) => elementReadout(g, compiled, result, id),
  };
}

describe('§1.2 mode agreement invariant', () => {
  it('holds on 200 random models', () => {
    let checkedValues = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const g = randomModel(seed);
      const { pfd, map, readout } = lists(g);
      const errors = modeAgreement(pfd, map, readout);
      expect(errors, `seed ${seed}`).toEqual([]);
      expect(map).toHaveLength(g.tiles.length + g.instruments.length);
      checkedValues += map.reduce((n, i) => n + Object.keys(i.values).length, 0);
    }
    // Not vacuous: plenty of numbers were actually compared.
    expect(checkedValues).toBeGreaterThan(500);
  });

  it('fails on each kind of injected mismatch', () => {
    const g = randomModel(42);
    const { pfd, map, readout } = lists(g);
    expect(modeAgreement(pfd, map, readout)).toEqual([]);
    const withValue = map.find((i) => Object.keys(i.values).length)!;
    const key = Object.keys(withValue.values)[0] as ValueKey;

    // 1. an element missing from one mode
    expect(modeAgreement(pfd, map.slice(1), readout)).toContainEqual(expect.stringMatching(/id sets differ/));
    // 2. a number computed in the renderer instead of read
    const nudged = map.map((i) => (i === withValue ? { ...i, values: { ...i.values, [key]: i.values[key]! * 1.0000001 } } : i));
    expect(modeAgreement(pfd, nudged, readout)).toContainEqual(expect.stringMatching(new RegExp(`${withValue.id}\\.${key}`)));
    // 3. a mode-specific layout (element drawn at another cell)
    const moved = pfd.map((i, n) => (n === 0 ? { ...i, cell: { col: i.cell.col + 1, row: i.cell.row } } : i));
    expect(modeAgreement(moved, map, readout)).toContainEqual(expect.stringMatching(/cell differs/));
    // 4. a duplicated element
    expect(modeAgreement([...pfd, pfd[0]], map, readout)).toContainEqual('duplicate id in a list');
  });
});
