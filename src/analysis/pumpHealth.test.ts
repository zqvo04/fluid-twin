import { describe, it, expect } from 'vitest';
import { analyzePumpHealth } from './pumpHealth';
import { solveSteadyState } from '../physics/steadySolver';
import { waterProperties } from '../domain/fluid';
import { PUMP_50M } from '../domain/catalog/pumps';
import { PipelineNetwork } from '../domain/network';

const fluid = waterProperties(20);

/**
 * Pump lifting `staticLift` metres from a flooded suction into an elevated
 * tank. The suction is held well above the pump (SUCTION_HEAD) so NPSH is
 * never the binding constraint in these cases — the duty-point tests are
 * about the BEP window alone.
 */
const SUCTION_HEAD = 15;

function pumpToTank(staticLift: number, pipeLength: number): PipelineNetwork {
  const tankHead = SUCTION_HEAD + staticLift;
  return {
    temperatureC: 20,
    subAssemblies: [],
    nodes: [
      { id: 'LOW', type: 'reservoir', position: { x: 0, y: 0, z: 0 }, fixedHead: SUCTION_HEAD },
      { id: 'J', type: 'junction', position: { x: 1, y: 0, z: 0 }, demand: 0 },
      { id: 'HIGH', type: 'reservoir', position: { x: 300, y: tankHead, z: 0 }, fixedHead: tankHead },
    ],
    links: [
      { id: 'PUMP', kind: 'pump', from: 'LOW', to: 'J', spec: PUMP_50M, speedRatio: 1 },
      { id: 'DISCHARGE', kind: 'pipe', from: 'J', to: 'HIGH', nps: '4"', schedule: '40', length: pipeLength },
    ],
  };
}

function health(net: PipelineNetwork, id = 'PUMP') {
  const res = solveSteadyState(net);
  expect(res.converged).toBe(true);
  return { res, h: analyzePumpHealth(net, res, fluid).find((x) => x.linkId === id)! };
}

describe('duty point against the BEP window', () => {
  it('classifies a near-BEP duty as ok with no stress', () => {
    const { h } = health(pumpToTank(30, 300));
    expect(h.bepRatio).toBeGreaterThan(0.7);
    expect(h.bepRatio).toBeLessThan(1.2);
    expect(h.state).toBe('ok');
    expect(h.stress).toBe(0);
  });

  it('flags overload when system resistance is very low (runout)', () => {
    const { h } = health(pumpToTank(2, 20));
    expect(h.bepRatio).toBeGreaterThan(1.2);
    expect(h.state).toBe('overload');
    expect(h.stress).toBeGreaterThan(0);
  });

  it('flags low-flow when the static lift approaches shutoff head', () => {
    const { h } = health(pumpToTank(50, 300));
    expect(h.bepRatio).toBeLessThan(0.7);
    expect(h.state).toBe('low-flow');
  });
});

describe('churn / deadhead (공회전)', () => {
  /** Pump running into a shut discharge valve. */
  function deadhead(opening: number): PipelineNetwork {
    return {
      temperatureC: 20,
      subAssemblies: [],
      nodes: [
        { id: 'LOW', type: 'reservoir', position: { x: 0, y: 0, z: 0 }, fixedHead: 0 },
        { id: 'J', type: 'junction', position: { x: 1, y: 0, z: 0 }, demand: 0 },
        { id: 'K', type: 'junction', position: { x: 2, y: 0, z: 0 }, demand: 0 },
        { id: 'HIGH', type: 'reservoir', position: { x: 100, y: 10, z: 0 }, fixedHead: 10 },
      ],
      links: [
        { id: 'PUMP', kind: 'pump', from: 'LOW', to: 'J', spec: PUMP_50M, speedRatio: 1 },
        { id: 'V', kind: 'valve', from: 'J', to: 'K', valveType: 'gate', nps: '4"', schedule: '40', opening },
        { id: 'D', kind: 'pipe', from: 'K', to: 'HIGH', nps: '4"', schedule: '40', length: 100 },
      ],
    };
  }

  it('a shut discharge leaves the pump churning at full stress', () => {
    const { h } = health(deadhead(0));
    expect(Math.abs(h.flow)).toBeLessThan(0.1 * h.bepFlow);
    expect(h.state).toBe('churn');
    expect(h.stress).toBeGreaterThan(0.9);
  });

  it('churn absorbs shaft power and turns all of it into casing heat', () => {
    const { h } = health(deadhead(0));
    expect(h.shaftPower).toBeGreaterThan(0);
    // With no throughflow, essentially none of the shaft power leaves as work.
    expect(h.heatPower).toBeGreaterThan(0.99 * h.shaftPower);
    expect(h.tempRiseRate).toBeGreaterThan(0);
    expect(h.secondsToTempLimit).toBeGreaterThan(0);
    expect(Number.isFinite(h.secondsToTempLimit)).toBe(true);
    // A minimum-flow line would have to pass a real, non-trivial flow.
    expect(h.minThermalFlow).toBeGreaterThan(0);
  });

  it('opening the discharge relieves the churn heat and the stress', () => {
    const shut = health(deadhead(0)).h;
    const open = health(deadhead(1)).h;
    expect(open.flow).toBeGreaterThan(shut.flow);
    expect(open.heatPower).toBeLessThan(shut.heatPower);
    expect(open.stress).toBeLessThan(shut.stress);
    expect(open.state).not.toBe('churn');
  });

  it('a stopped pump is idle, not churning', () => {
    const net = deadhead(1);
    const pump = net.links.find((l) => l.id === 'PUMP')!;
    if (pump.kind === 'pump') pump.speedRatio = 0;
    const { h } = health(net);
    expect(h.state).toBe('stopped');
    expect(h.stress).toBe(0);
    expect(h.shaftPower).toBe(0);
  });
});

describe('suction side: the pump pulls with pressure, not with the motor', () => {
  /** Sump at `suctionElevation` feeding a pump whose suction node is at grade. */
  function suctionLift(suctionElevation: number): PipelineNetwork {
    return {
      temperatureC: 20,
      subAssemblies: [],
      nodes: [
        { id: 'SUMP', type: 'reservoir', position: { x: 0, y: suctionElevation, z: 0 }, fixedHead: suctionElevation },
        { id: 'PIN', type: 'junction', position: { x: 1, y: 0, z: 0 }, demand: 0 },
        { id: 'TANK', type: 'reservoir', position: { x: 50, y: 20, z: 0 }, fixedHead: 20 },
      ],
      links: [
        { id: 'SUCT', kind: 'pipe', from: 'SUMP', to: 'PIN', nps: '6"', schedule: '40', length: 5 },
        { id: 'PUMP', kind: 'pump', from: 'PIN', to: 'TANK', spec: PUMP_50M, speedRatio: 1 },
      ],
    };
  }

  it('a flooded suction has healthy NPSH margin and full curve head', () => {
    const { h } = health(suctionLift(5));
    expect(h.npshAvailable).toBeGreaterThan(h.npshRequired);
    expect(h.npshMargin).toBeGreaterThan(0);
    expect(h.suctionFactor).toBe(1);
    expect(h.state).not.toBe('cavitating');
    expect(h.state).not.toBe('dry-run');
  });

  it('deep suction lift starves the impeller: NPSHa collapses and head goes with it', () => {
    const flooded = health(suctionLift(5)).h;
    const lifted = health(suctionLift(-9)).h;

    expect(lifted.npshAvailable).toBeLessThan(flooded.npshAvailable);
    expect(lifted.npshMargin).toBeLessThan(0);
    expect(lifted.suctionFactor).toBeLessThan(1);
    expect(['cavitating', 'dry-run']).toContain(lifted.state);
    expect(lifted.stress).toBeGreaterThan(0);
    // The motor is unchanged; the atmosphere is what ran out.
    expect(lifted.flow).toBeLessThan(flooded.flow);
  });

  it('flow falls monotonically as the suction is lowered', () => {
    const flows = [5, 0, -3, -6, -9].map((e) => health(suctionLift(e)).h.flow);
    for (let i = 1; i < flows.length; i++) expect(flows[i]).toBeLessThan(flows[i - 1]);
  });

  it('NPSHa falls about one metre per metre of extra lift', () => {
    const a = health(suctionLift(0)).h;
    const b = health(suctionLift(-3)).h;
    expect(a.npshAvailable - b.npshAvailable).toBeGreaterThan(2.5);
  });
});

describe('direction: a pump is a one-way machine', () => {
  /** Discharge tank held far above the pump's shutoff head, so the system
   *  tries to push backwards through the pump. */
  function backPressure(checkValve: boolean): PipelineNetwork {
    return {
      temperatureC: 20,
      subAssemblies: [],
      nodes: [
        { id: 'LOW', type: 'reservoir', position: { x: 0, y: 0, z: 0 }, fixedHead: 0 },
        { id: 'J', type: 'junction', position: { x: 1, y: 0, z: 0 }, demand: 0 },
        { id: 'HIGH', type: 'reservoir', position: { x: 100, y: 120, z: 0 }, fixedHead: 120 },
      ],
      links: [
        { id: 'PUMP', kind: 'pump', from: 'LOW', to: 'J', spec: PUMP_50M, speedRatio: 1, checkValve },
        { id: 'D', kind: 'pipe', from: 'J', to: 'HIGH', nps: '4"', schedule: '40', length: 100 },
      ],
    };
  }

  it('the discharge check valve blocks reverse flow through a running pump', () => {
    const { res } = health(backPressure(true));
    expect(res.links.get('PUMP')!.flow).toBeGreaterThan(-1e-4);
  });

  it('without a check valve the same system drives flow backwards', () => {
    const { res } = health(backPressure(false));
    expect(res.links.get('PUMP')!.flow).toBeLessThan(-1e-3);
  });
});
