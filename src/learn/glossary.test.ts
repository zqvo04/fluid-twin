import { describe, it, expect } from 'vitest';
import { GLOSSARY, easyName } from './glossary';
import { KIND_LABEL } from '../ui/kindLabels';

describe('glossary', () => {
  it('has a complete entry for every tile and instrument kind', () => {
    const kinds = [...Object.keys(KIND_LABEL), 'FI', 'PI', 'LI', 'FIC'];
    expect(Object.keys(GLOSSARY).sort()).toEqual(kinds.sort());
    for (const k of kinds) {
      const e = GLOSSARY[k as keyof typeof GLOSSARY];
      expect(e.name, k).not.toBe('');
      expect(e.what, k).not.toBe('');
      expect(e.symbol, k).not.toBe('');
    }
  });

  it('every tagged kind explains how to read its tag code', () => {
    const code: Record<string, string> = { valve: 'FCV', pump: 'P-101A', basin: 'TK', strainer: 'S-101', hx: 'E-101', spray: 'CT', FI: 'FI', PI: 'PI', LI: 'LI', FIC: 'FIC' };
    for (const [k, c] of Object.entries(code)) expect(GLOSSARY[k as keyof typeof GLOSSARY].tag).toContain(c);
  });

  it('easy name adds A/B for pumps and control/hand for valves', () => {
    expect(easyName('pump', 'P-101A')).toBe('펌프 A');
    expect(easyName('pump', 'P-101')).toBe('펌프');
    expect(easyName('valve', 'HV-102')).toBe('수동밸브');
    expect(easyName('valve', 'FCV-101')).toBe('제어밸브');
    expect(easyName('valve')).toBe('밸브');
    expect(easyName('FI')).toBe('유량계');
  });
});
