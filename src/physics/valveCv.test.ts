/**
 * V&V-9 (PLAN-V2 §5): flow through a valve at each opening = its Cv
 * characteristic. A valve alone between two reservoirs at a fixed ΔH, so the
 * flow depends on nothing but the valve.
 */
import { describe, it, expect } from 'vitest';
import { solveSteadyState } from './steadySolver';
import { PipelineNetwork } from '../domain/network';
import { VALVE_SPECS, VALVE_TYPES, ValveType, characteristicFraction, ratedCv } from '../domain/catalog/valves';
import { G, gpmToM3s, paToPsi } from '../domain/units';

const DH = 10; // reservoir head difference [m]

function valveOnly(type: ValveType, opening: number): PipelineNetwork {
  return {
    temperatureC: 20,
    subAssemblies: [],
    nodes: [
      { id: 'A', type: 'reservoir', position: { x: 0, y: 0, z: 0 }, fixedHead: DH },
      { id: 'B', type: 'reservoir', position: { x: 1, y: 0, z: 0 }, fixedHead: 0 },
    ],
    links: [{ id: 'V', kind: 'valve', from: 'A', to: 'B', valveType: type, nps: '4"', schedule: '40', opening }],
  };
}

const OPENINGS = [0.1, 0.2, 0.3, 0.5, 0.7, 0.9, 1];

describe('V&V-9 valve flow = Cv characteristic', () => {
  for (const type of VALVE_TYPES) {
    it(`${type}: Q(θ)/Q(100 %) = inherent characteristic f(θ), every opening`, () => {
      const qOpen = solveSteadyState(valveOnly(type, 1)).links.get('V')!.flow;
      for (const t of OPENINGS) {
        const q = solveSteadyState(valveOnly(type, t)).links.get('V')!.flow;
        expect(q / qOpen, `θ=${t}`).toBeCloseTo(characteristicFraction(VALVE_SPECS[type].characteristic, t), 6);
      }
    });

    it(`${type}: absolute flow = Cv·√(ΔP/SG) (ISA/IEC 60534 US units) within 1 %`, () => {
      for (const t of OPENINGS) {
        const res = solveSteadyState(valveOnly(type, t));
        const rho = res.fluid.rho;
        const cv = ratedCv(type, '4"', '40') * characteristicFraction(VALVE_SPECS[type].characteristic, t);
        const qRef = gpmToM3s(cv * Math.sqrt(paToPsi(rho * G * DH) / (rho / 999)));
        expect(Math.abs(res.links.get('V')!.flow / qRef - 1), `θ=${t}`).toBeLessThan(0.01);
      }
    });
  }
});
