import { describe, it, expect } from 'vitest';
import {
  linkOpenFraction,
  mixLateral,
  profileSpeedFactor,
  throatContraction,
  throatSpeedFactor,
} from './flowProfile';
import { NetworkLink } from '../domain/network';
import { PUMP_50M } from '../domain/catalog/pumps';

/** Deterministic PRNG (mulberry32) so the statistical tests are reproducible. */
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

describe('velocity profile across the bore', () => {
  it('runs fastest on the centreline and slowest at the wall', () => {
    expect(profileSpeedFactor(0)).toBeGreaterThan(profileSpeedFactor(0.5));
    expect(profileSpeedFactor(0.5)).toBeGreaterThan(profileSpeedFactor(1));
    expect(profileSpeedFactor(0.5)).toBeCloseTo(profileSpeedFactor(-0.5), 12);
    expect(profileSpeedFactor(1)).toBeGreaterThan(0); // never stalls completely
  });

  it('averages to the bulk velocity, so the profile changes shape not pace', () => {
    let sum = 0;
    const N = 20001;
    for (let i = 0; i < N; i++) sum += profileSpeedFactor((i / (N - 1)) * 2 - 1);
    expect(sum / N).toBeCloseTo(1, 2);
  });
});

describe('turbulent cross-mixing', () => {
  it('keeps particles inside the pipe', () => {
    const rand = mulberry32(11);
    let u = 0.9;
    for (let i = 0; i < 5000; i++) {
      u = mixLateral(u, 0.5, rand);
      expect(u).toBeGreaterThanOrEqual(-1);
      expect(u).toBeLessThanOrEqual(1);
    }
  });

  it('spreads a stream that starts on the centreline across the bore', () => {
    const rand = mulberry32(5);
    let us = Array.from({ length: 2000 }, () => 0);
    // A few cells of travel is enough to mix a dye filament across the bore.
    for (let step = 0; step < 20; step++) us = us.map((u) => mixLateral(u, 0.5, rand));
    const spread = Math.sqrt(us.reduce((a, u) => a + u * u, 0) / us.length);
    expect(spread).toBeGreaterThan(0.3);
  });

  it('leaves an already-uniform spread uniform (no drift toward the wall)', () => {
    const rand = mulberry32(9);
    const N = 4000;
    let us = Array.from({ length: N }, (_, i) => (i / (N - 1)) * 2 - 1);
    for (let step = 0; step < 40; step++) us = us.map((u) => mixLateral(u, 0.3, rand));
    const mean = us.reduce((a, u) => a + u, 0) / N;
    const nearWall = us.filter((u) => Math.abs(u) > 0.8).length / N;
    expect(Math.abs(mean)).toBeLessThan(0.05);
    // A uniform spread puts 20% of particles in the outer 20% of the bore.
    expect(nearWall).toBeGreaterThan(0.12);
    expect(nearWall).toBeLessThan(0.3);
  });

  it('does not move a particle that did not travel', () => {
    expect(mixLateral(0.42, 0, mulberry32(1))).toBe(0.42);
  });
});

describe('vena contracta through a throttled valve', () => {
  it('leaves a full-bore link completely untouched', () => {
    for (const s of [0, 0.25, 0.5, 0.75, 1]) {
      expect(throatSpeedFactor(1, s)).toBe(1);
      expect(throatContraction(1, s)).toBe(1);
    }
  });

  it('accelerates the flow through the gap and returns it to bulk at the ends', () => {
    const open = 0.25;
    expect(throatSpeedFactor(open, 0.5)).toBeGreaterThan(2);
    // Exactly bulk at both ends, so there is no speed seam where this link
    // meets the pipe on either side of it.
    expect(throatSpeedFactor(open, 0)).toBe(1);
    expect(throatSpeedFactor(open, 1)).toBe(1);
  });

  it('makes the jet faster the further the valve is shut', () => {
    const speeds = [0.9, 0.6, 0.4, 0.2, 0.05].map((o) => throatSpeedFactor(o, 0.5));
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]).toBeGreaterThan(speeds[i - 1]);
  });

  it('squeezes the stream into a narrow thread at the gap, and only there', () => {
    const open = 0.16;
    expect(throatContraction(open, 0.5)).toBeLessThan(0.5);
    expect(throatContraction(open, 0)).toBe(1);
    expect(throatContraction(open, 1)).toBe(1);
    // Narrower the further it is shut.
    expect(throatContraction(0.04, 0.5)).toBeLessThan(throatContraction(0.5, 0.5));
  });

  it('caps the jet so a nearly-shut valve cannot fling particles off-screen', () => {
    expect(throatSpeedFactor(1e-9, 0.5)).toBeLessThanOrEqual(8);
    expect(throatContraction(1e-9, 0.5)).toBeGreaterThan(0.1);
  });
});

describe('linkOpenFraction', () => {
  const valve = (opening: number): NetworkLink => ({
    id: 'V',
    kind: 'valve',
    from: 'a',
    to: 'b',
    valveType: 'globe',
    nps: '4"',
    schedule: '40',
    opening,
  });

  it('is 1 for a full-bore link and for anything that is not a valve', () => {
    expect(linkOpenFraction(valve(1))).toBeCloseTo(1, 6);
    expect(linkOpenFraction({ id: 'P', kind: 'pipe', from: 'a', to: 'b', nps: '4"', schedule: '40' })).toBe(1);
    expect(linkOpenFraction({ id: 'M', kind: 'pump', from: 'a', to: 'b', spec: PUMP_50M, speedRatio: 1 })).toBe(1);
  });

  it('follows the valve type’s inherent characteristic, not the raw stem position', () => {
    // A globe valve is equal-percentage: half open passes far less than half.
    expect(linkOpenFraction(valve(0.5))).toBeLessThan(0.3);
    expect(linkOpenFraction(valve(0.2))).toBeLessThan(linkOpenFraction(valve(0.5)));
  });
});
