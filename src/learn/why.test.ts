import { describe, it, expect } from 'vitest';
import { pumpChart, valveChart } from './why';
import { explain } from './explain';
import { GRID_PRESETS } from '../examples/gridPresets';
import { compile } from '../grid/compile';
import { solveSteadyState } from '../physics/steadySolver';
import { elementReadout } from '../readouts';
import { pumpHead } from '../domain/catalog/pumps';
import { m3hToM3s } from '../domain/units';

const grid = GRID_PRESETS.find((p) => p.name === '개방형 냉각수 루프')!.build();
const compiled = compile(grid);
const result = solveSteadyState(compiled.network);
const byTag = (tag: string) => grid.tiles.find((t) => 'tag' in t && t.tag === tag)!;
const read = (id: string) => elementReadout(grid, compiled, result, id)!;

describe('"왜?" pump chart', () => {
  const pump = byTag('P-101A');
  const chart = pumpChart(grid, result, pump.id)!;

  it('marks the duty point = readouts (flowM3h, headM)', () => {
    expect(chart.duty).toEqual({ x: read(pump.id).flowM3h, y: read(pump.id).headM });
  });

  it('the duty point sits on the pump curve and on the system curve', () => {
    const spec = pump.kind === 'pump' ? pump.spec : null!;
    expect(pumpHead(spec, m3hToM3s(chart.duty.x), 1)).toBeCloseTo(chart.duty.y, 3);
    // Speed ×1 is one of the traced system points: the duty point itself.
    expect(chart.system.some((p) => Math.abs(p.x - chart.duty.x) < 1e-6 && Math.abs(p.y - chart.duty.y) < 1e-6)).toBe(true);
  });

  it('system curve rises with flow; pump curve falls past its peak', () => {
    expect(chart.system.length).toBeGreaterThanOrEqual(6);
    for (let i = 1; i < chart.system.length; i++) expect(chart.system[i].y).toBeGreaterThan(chart.system[i - 1].y);
    const last = chart.pump[chart.pump.length - 1];
    expect(last.y).toBeLessThan(chart.pump[0].y);
  });

  it('none for a stopped pump', () => {
    expect(pumpChart(grid, result, byTag('P-101B').id)).toBeNull();
  });
});

describe('"왜?" valve chart', () => {
  const fcv = byTag('FCV-101');
  const chart = valveChart(grid, result, fcv.id)!;

  it('marks the current point = readouts (openingPct, flowM3h), on the curve', () => {
    expect(chart.now).toEqual({ x: read(fcv.id).openingPct, y: read(fcv.id).flowM3h });
    const at50 = chart.curve.find((p) => p.x === 50)!;
    expect(at50.y).toBeCloseTo(chart.now.y, 6);
  });

  it('flow rises with opening, from ~0 shut', () => {
    expect(chart.curve).toHaveLength(11);
    expect(chart.curve[0].y).toBeLessThan(0.5);
    for (let i = 1; i < chart.curve.length; i++) expect(chart.curve[i].y).toBeGreaterThanOrEqual(chart.curve[i - 1].y);
  });
});

describe('warning explanations', () => {
  it('turns each finding clause into what / why / fix', () => {
    const cases: Array<[string, RegExp]> = [
      ['Hoop stress 120 MPa exceeds allowable S 138 MPa (util 87%). (ASME B31.3 §302.3)', /원주응력/],
      ['Velocity 6.1 m/s exceeds erosional limit 4.9 m/s. (API RP 14E)', /침식/],
      ['Valve cavitating: σ 1.1 < incipient 1.7 at ΔP 9.0 m. (ISA cavitation index)', /캐비테이션/],
      ['Churning against a shut discharge at 0% BEP: … (Minimum continuous thermal flow (HI 9.6.3 / API 610))', /체절/],
      ['NPSHa 2.1 m below NPSHr 3.5 m (NPSH margin (HI 9.6.1))', /NPSH/],
    ];
    for (const [msg, re] of cases) {
      const e = explain(msg);
      expect(e.what, msg).toMatch(re);
      expect(e.why.length).toBeGreaterThan(5);
      expect(e.fix.length).toBeGreaterThan(5);
    }
  });

  it('tells runout from low flow by the % BEP in the message', () => {
    expect(explain('Running out on the curve at 152% BEP — … (Hydraulic Institute (70–120% BEP))').fix).toMatch(/조여/);
    expect(explain('Low-flow operation at 40% BEP — … (Hydraulic Institute (70–120% BEP))').fix).toMatch(/열거나/);
  });

  it('falls back to the raw message for structural issues', () => {
    expect(explain('Tile at (3, 4) is isolated and excluded from the analysis.').what).toMatch(/isolated/);
  });
});
