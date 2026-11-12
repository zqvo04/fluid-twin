import { describe, it, expect } from 'vitest';
import { GUIDES } from './guides';
import { Guide, GuideContext, Tab, advance, guideContext } from './guide';
import { GRID_PRESETS } from '../examples/gridPresets';
import { compile } from '../grid/compile';
import { updateTile } from '../grid/ops';
import { GridModel, Tile } from '../grid/types';
import { solveSteadyState } from '../physics/steadySolver';

const preset = () => GRID_PRESETS.find((p) => p.name === '개방형 냉각수 루프')!.build();

/** A user operating the app: edits by tag, switches tabs, and reads the guide's context. */
class Player {
  grid: GridModel = preset();
  tab: Tab = 'map';
  set(tag: string, patch: Partial<Tile>) {
    const t = this.grid.tiles.find((x) => 'tag' in x && x.tag === tag)!;
    this.grid = updateTile(this.grid, t.id, patch);
  }
  ctx(): GuideContext {
    const c = compile(this.grid);
    const r = solveSteadyState(c.network);
    expect(r.converged).toBe(true);
    return guideContext(this.grid, c, r, this.tab);
  }
}

/** Do each step's action in turn: the guide must wait for it, then move exactly one step. */
function play(guide: Guide, actions: Array<(p: Player) => void>, check: (step: number, c: GuideContext) => void) {
  const p = new Player();
  let i = advance(guide, 0, p.ctx());
  expect(i).toBe(0); // starting on the map: nothing is done yet
  actions.forEach((act, n) => {
    act(p);
    const c = p.ctx();
    check(n, c);
    const next = advance(guide, i, c);
    expect(next, `step ${n + 1} "${guide.steps[n].text.slice(0, 24)}…"`).toBe(n + 1);
    i = next;
  });
  expect(i).toBe(guide.steps.length);
}

describe('guide engine', () => {
  it('does not advance past a step whose condition does not hold', () => {
    const p = new Player();
    p.tab = 'pfd';
    const g = GUIDES[0];
    // Step 1 (be on the PFD) holds; step 2 (B running) does not.
    expect(advance(g, 0, p.ctx())).toBe(1);
    expect(advance(g, 1, p.ctx())).toBe(1);
  });
});

describe('guide (a): pump A → B, played through on the reference loop', () => {
  const g = GUIDES.find((x) => x.id === 'pump-switch')!;
  const fi = (c: GuideContext) => c.read('FI-101')!.value!;
  const pi = (c: GuideContext) => c.read('PI-101')!.value!;
  let fiA = 0;
  let piA = 0;
  let fiAB = 0;

  it('every quoted figure is what the loop actually does', () => {
    const base = new Player().ctx();
    fiA = fi(base);
    piA = pi(base);
    expect(fiA).toBeGreaterThan(88); // "약 92 m³/h"
    expect(fiA).toBeLessThan(96);
    play(
      g,
      [
        (p) => (p.tab = 'pfd'),
        (p) => p.set('P-101B', { running: true }),
        (p) => (p.tab = 'map'),
        (p) => (p.tab = 'pfd'),
        (p) => p.set('P-101A', { running: false }),
        (p) => (p.tab = 'map'),
      ],
      (step, c) => {
        if (step === 1) {
          fiAB = fi(c);
          // "총 유량은 약 7 %만": parallel pumps on a throttled loop
          expect(fiAB / fiA - 1).toBeGreaterThan(0.03);
          expect(fiAB / fiA - 1).toBeLessThan(0.12);
          // "각 펌프는 BEP의 약 50 %": 100 m³/h BEP
          for (const t of ['P-101A', 'P-101B']) {
            expect(c.read(t)!.flowM3h!).toBeGreaterThan(40);
            expect(c.read(t)!.flowM3h!).toBeLessThan(60);
          }
          // "약 4.7 → 5.2 bar g": discharge pressure rises more than flow
          expect(piA).toBeCloseTo(4.7, 1);
          expect(pi(c)).toBeCloseTo(5.2, 1);
        }
        if (step === 4) {
          // "유량이 전환 전과 거의 같다, 약간 적음"
          expect(fi(c)).toBeLessThan(fiA);
          expect(fi(c) / fiA).toBeGreaterThan(0.98);
          expect(Math.abs(c.read('P-101A')!.flowM3h!)).toBeLessThan(0.1); // check valve: no backflow
        }
      },
    );
  });
});

describe('guide (b): control valve and bypass, played through', () => {
  const g = GUIDES.find((x) => x.id === 'fcv-bypass')!;
  it('every quoted figure is what the loop actually does', () => {
    const piBase = new Player().ctx().read('PI-101')!.value!;
    play(
      g,
      [
        (p) => (p.tab = 'pfd'),
        (p) => p.set('FCV-101', { opening: 0.3 }),
        (p) => (p.tab = 'map'),
        (p) => (p.tab = 'pfd'),
        (p) => p.set('HV-102', { opening: 0.5 }),
        (p) => (p.tab = 'map'),
      ],
      (step, c) => {
        if (step === 1) {
          const q = c.read('FI-101')!.value!;
          expect(q).toBeGreaterThan(35); // "약 40 m³/h, BEP의 40 %"
          expect(q).toBeLessThan(45);
          const pi = c.read('PI-101')!.value!;
          expect(pi).toBeGreaterThan(piBase); // throttling raises discharge pressure
          expect(pi).toBeCloseTo(5.3, 1); // "약 5.3 bar g"
        }
        if (step === 4) {
          const total = c.read('FI-101')!.value!;
          const bypass = c.read('HV-102')!.flowM3h!;
          const fcv = c.read('FCV-101')!.flowM3h!;
          expect(total).toBeGreaterThan(100); // "약 110 m³/h"
          expect(total).toBeLessThan(120);
          expect(bypass).toBeGreaterThan(75); // "중 80"
          expect(bypass).toBeLessThan(85);
          expect(fcv).toBeGreaterThan(25); // "FCV는 30 m³/h만"
          expect(fcv).toBeLessThan(35);
          expect(bypass + fcv).toBeCloseTo(total, 6);
        }
      },
    );
  });
});
