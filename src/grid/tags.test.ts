import { describe, it, expect } from 'vitest';
import { nextTag, parseTag, validateTags } from './tags';
import { emptyGrid, GridModel, PumpTile } from './types';
import { updateTile } from './ops';
import { place, coolingLoop } from './testLoop';

describe('tag format', () => {
  it.each(['TK-101', 'S-101', 'P-101', 'P-101A', 'P-112B', 'E-101', 'FCV-101', 'HV-102', 'CT-101', 'FI-101', 'PI-103', 'LI-101', 'FIC-101'])(
    'accepts %s',
    (tag) => expect(parseTag(tag)).not.toBeNull(),
  );

  it.each(['HV-101A', 'FI-101B', 'P-201A', 'TK-100', 'TK-1001', 'XX-101', 'tk-101', 'TK101', ''])(
    'rejects %s',
    (tag) => expect(parseTag(tag)).toBeNull(),
  );

  it('parses FIC as FIC, not FI', () => {
    expect(parseTag('FIC-101')?.code).toBe('FIC');
  });
});

describe('auto-assignment on placement', () => {
  it('numbers each code from 01 independently', () => {
    let g = emptyGrid(6, 1);
    g = place(g, 'valve', 0, 0, ['E', 'W']);
    g = place(g, 'valve', 1, 0, ['E', 'W']);
    g = place(g, 'strainer', 2, 0, ['E', 'W']);
    g = place(g, 'basin', 3, 0, ['E']);
    expect(g.tiles.map((t) => ('tag' in t ? t.tag : ''))).toEqual(['HV-101', 'HV-102', 'S-101', 'TK-101']);
  });

  it('pairs pumps A/B on one number; B is the stopped standby', () => {
    let g = emptyGrid(3, 1);
    g = place(g, 'pump', 0, 0, ['W', 'E']);
    g = place(g, 'pump', 1, 0, ['W', 'E']);
    g = place(g, 'pump', 2, 0, ['W', 'E']);
    const pumps = g.tiles as PumpTile[];
    expect(pumps.map((p) => p.tag)).toEqual(['P-101A', 'P-101B', 'P-102A']);
    expect(pumps.map((p) => p.running)).toEqual([true, false, true]);
  });

  it('reuses the lowest free number', () => {
    const g: GridModel = { ...emptyGrid(1, 1), instruments: [{ tag: 'FI-102', type: 'FI', targetId: 'x' }] };
    expect(nextTag(g, 'FI')).toBe('FI-101');
    expect(nextTag({ ...g, instruments: [...g.instruments, { tag: 'FI-101', type: 'FI', targetId: 'x' }] }, 'FI')).toBe('FI-103');
  });

  it('skips a pump number whose B alone is taken', () => {
    const g: GridModel = { ...emptyGrid(1, 1), instruments: [] };
    const withB = { ...g, tiles: [{ ...(place(g, 'pump', 0, 0, ['W', 'E']).tiles[0] as PumpTile), tag: 'P-101B' }] };
    expect(nextTag(withB, 'P')).toBe('P-102A');
  });
});

describe('validateTags', () => {
  it('the cooling loop is clean', () => {
    expect(validateTags(coolingLoop().grid)).toEqual([]);
  });

  it('flags duplicates, bad format, and code/role mismatch', () => {
    const { grid, ids } = coolingLoop();
    let g = updateTile(grid, ids.hx, { tag: 'S-101' }); // duplicate of the strainer + wrong code
    g = updateTile(g, ids.basin, { tag: 'TANK-1' });
    g = updateTile(g, ids.valve, { service: 'manual' }); // FCV-101 on a hand valve
    g = { ...g, instruments: [{ tag: 'FI-101', type: 'PI', targetId: ids.hx }] };
    const msgs = validateTags(g).map((i) => i.message);
    expect(msgs).toEqual(
      expect.arrayContaining([
        'Tag "S-101" is used 2 times.',
        'Tag "S-101" should use code E.',
        'Tag "TANK-1" does not match {code}-1nn[A|B].',
        'Tag "FCV-101" should use code HV.',
        'Tag "FI-101" should use code PI.',
      ]),
    );
    expect(validateTags(g).every((i) => i.severity === 'warning')).toBe(true);
  });
});
