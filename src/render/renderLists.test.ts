import { describe, it, expect } from 'vitest';
import { buildPfdList } from './pfdLayer';
import { buildMapList } from './mapLayer';
import { compile } from '../grid/compile';
import { coolingLoop } from '../grid/testLoop';
import { GRID_PRESETS } from '../examples/gridPresets';
import { GridModel } from '../grid/types';
import { solveSteadyState } from '../physics/steadySolver';
import { elementReadout, streamTable } from '../readouts';

const { grid: base, ids } = coolingLoop();
const grid: GridModel = {
  ...base,
  instruments: [
    { tag: 'FI-101', type: 'FI', targetId: ids.pump },
    { tag: 'FIC-101', type: 'FIC', targetId: ids.valve },
    { tag: 'LI-101', type: 'LI', targetId: ids.basin },
  ],
};
const compiled = compile(grid);
const result = solveSteadyState(compiled.network);
const pfd = buildPfdList(grid, compiled, result);
const map = buildMapList(grid, compiled, result);
const pfdItem = (id: string) => pfd.items.find((i) => i.id === id)!;
const mapItem = (id: string) => map.find((i) => i.id === id)!;

describe('PFD render list', () => {
  it('maps every element to its ISO symbol; the FCV carries the actuator', () => {
    expect(pfdItem(ids.basin).symbol).toBe('tank');
    expect(pfdItem(ids.strainer).symbol).toBe('strainer');
    expect(pfdItem(ids.pump).symbol).toBe('pump');
    expect(pfdItem(ids.hx).symbol).toBe('hx');
    expect(pfdItem(ids.valve)).toMatchObject({ symbol: 'gateValve', control: true });
    expect(pfdItem(ids.spray).symbol).toBe('spray');
    expect(pfdItem(ids.riser).symbol).toBeUndefined(); // a pipe is a line
  });

  it('labels equipment tag first, easy name second; the pump symbol points at its discharge', () => {
    expect(pfdItem(ids.pump).labels).toEqual(['P-101A', '펌프 A']);
    expect(pfdItem(ids.valve).labels).toEqual(['FCV-101', '제어밸브']);
    expect(pfdItem(ids.riser).labels).toEqual([]);
    expect(pfdItem(ids.pump).angle).toBeCloseTo(0, 12); // discharge E
    expect(pfdItem(ids.valve).angle).toBeCloseTo(0, 12); // horizontal body, actuator up
  });

  it('one numbered run per pipe link: line number, flow arrow along the flow', () => {
    expect(pfd.runs.map((r) => r.stream)).toEqual([1, 2, 3, 4, 5]);
    for (const r of pfd.runs) expect(r.lineNo).toMatch(/^4"-CW-10\d$/);
    // Run 5: FCV → elbow → riser → elbow → CT, flowing up the riser (screen −y).
    const riser = pfd.runs.find((r) => r.linkId === compiled.tileLink.get(ids.riser))!;
    expect(riser.angle).toBeCloseTo(-Math.PI / 2, 12);
    // The horizontal runs flow east.
    for (const r of pfd.runs.filter((x) => x !== riser)) expect(r.angle).toBeCloseTo(0, 12);
  });

  it('no arrow on a dead branch: leakage below table precision is not a direction', () => {
    const g = GRID_PRESETS.find((p) => p.name === '개방형 냉각수 루프')!.build();
    const c = compile(g);
    const list = buildPfdList(g, c, solveSteadyState(c.network));
    const runOf = (id: string) => list.runs.find((r) => r.linkId === c.tileLink.get(id))!;
    const tile = (tag: string) => g.tiles.find((t) => 'tag' in t && t.tag === tag)!;
    const nextTo = (tag: string, dc: number, dr: number) => g.tiles.find((t) => t.cell.col === tile(tag).cell.col + dc && t.cell.row === tile(tag).cell.row + dr)!.id;
    expect(runOf(nextTo('P-101B', 1, 0)).angle).toBeNull(); // stopped standby branch
    expect(runOf(nextTo('HV-102', 1, 1)).angle).toBeNull(); // shut bypass
    expect(runOf(nextTo('P-101A', 1, 0)).angle).toBeCloseTo(0, 12); // duty branch flows east
    expect(runOf(nextTo('HV-102', 1, 1)).vertical).toBe(true);
  });

  it('stream table = streamTable() rows plus their line numbers', () => {
    const rows = streamTable(compiled, result);
    expect(pfd.table.map(({ lineNo: _l, ...row }) => row)).toEqual(rows);
    expect(pfd.table.map((r) => r.lineNo)).toEqual(pfd.runs.map((r) => r.lineNo));
  });

  it('instrument bubbles show the readout value, at their target', () => {
    expect(pfdItem('FI-101')).toMatchObject({ kind: 'FI', cell: grid.tiles.find((t) => t.id === ids.pump)!.cell });
    expect(pfdItem('FI-101').values.value).toBe(elementReadout(grid, compiled, result, 'FI-101')!.value);
    expect(pfdItem('LI-101').values.value).toBe(1);
  });

  it('unsolved: symbols and line numbers, no arrows, no table', () => {
    const p = buildPfdList(grid, compiled, null);
    expect(p.runs).toHaveLength(5);
    expect(p.runs.every((r) => r.angle === null)).toBe(true);
    expect(p.table).toEqual([]);
    expect(p.items.find((i) => i.id === 'FI-101')!.values).toEqual({});
  });
});

describe('map render list', () => {
  it('easy name + tag, and only the key values per kind', () => {
    expect(mapItem(ids.pump).labels).toEqual(['펌프 A', 'P-101A']);
    expect(Object.keys(mapItem(ids.pump).values).sort()).toEqual(['flowM3h', 'speedPct']);
    expect(Object.keys(mapItem(ids.valve).values).sort()).toEqual(['flowM3h', 'openingPct']);
    expect(mapItem(ids.basin).values).toEqual({ levelM: 1 });
    expect(Object.keys(mapItem(ids.hx).values)).toEqual(['dpBar']);
    expect(mapItem(ids.riser)).toMatchObject({ labels: [], values: {} });
  });

  it('values are the readout values, unchanged', () => {
    const r = elementReadout(grid, compiled, result, ids.pump)!;
    expect(mapItem(ids.pump).values).toEqual({ flowM3h: r.flowM3h, speedPct: r.speedPct });
    expect(mapItem('FIC-101').values.value).toBe(elementReadout(grid, compiled, result, 'FIC-101')!.value);
  });
});
