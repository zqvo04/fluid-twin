/**
 * Quasi-steady scenario runner — the main timeline (PLAN-V2 §2.2).
 *
 * Every Δt (default 0.5 s): fire due events, move actuators (pump speed ramp,
 * pump coast-down, valve stroke), set basin heads from their levels, solve the
 * network with the steady GGA, then integrate basin levels over the step with
 * `A·dh/dt = Q_in − Q_out` (explicit Euler on the flows just solved).
 * Pressure waves are not modeled here — that is the MOC surge check's job.
 *
 * Works on the compiled PipelineNetwork; event `id`s are link ids
 * (grid/scenario.ts maps tile ids).
 */

import { PipelineNetwork, PumpLink } from '../domain/network';
import { waterProperties } from '../domain/fluid';
import { pumpShaftPower } from '../domain/catalog/pumps';
import { ScenarioEvent } from '../grid/types';
import { SteadyResult, solveSteadyState } from './steadySolver';

export interface ScenarioBasin {
  /** Reservoir node of the basin. */
  nodeId: string;
  /** Free-surface area [m²]. */
  area: number;
  /** Floor elevation [m]. */
  floor: number;
  /** Initial level above the floor [m]. */
  level: number;
  /** Atmospheric discharge nodes whose outflow falls back into this basin. */
  inflowNodeIds: string[];
}

export interface ScenarioModel {
  network: PipelineNetwork;
  basins: ScenarioBasin[];
  /** Pump link id → speed ratio it runs at once started. */
  nominalSpeed: Record<string, number>;
}

export interface ScenarioFrame {
  /** Scenario time [s]. */
  t: number;
  result: SteadyResult;
  /** Basin node id → level [m]. */
  levels: Record<string, number>;
  /** Pump link id → speed ratio. */
  speeds: Record<string, number>;
  /** Valve link id → opening 0..1. */
  openings: Record<string, number>;
}

export interface ScenarioOptions {
  durationS: number;
  /** Time step [s]. */
  dt?: number;
}

/** A linear move of one actuator from `from` at `t0` to `to` over `T` seconds. */
interface Ramp {
  t0: number;
  T: number;
  from: number;
  to: number;
}

const rampAt = (r: Ramp, t: number) => r.from + (r.to - r.from) * (r.T > 0 ? Math.min(1, Math.max(0, (t - r.t0) / r.T)) : 1);

/** Net flow leaving a node through its links [m³/s]. */
function nodeOutflow(net: PipelineNetwork, result: SteadyResult, nodeId: string): number {
  let q = 0;
  for (const l of net.links) {
    const f = result.links.get(l.id)?.flow ?? 0;
    if (l.from === nodeId) q += f;
    if (l.to === nodeId) q -= f;
  }
  return q;
}

/** Basin net inflow Q_in − Q_out [m³/s]. */
export function basinNetInflow(net: PipelineNetwork, result: SteadyResult, basin: ScenarioBasin): number {
  const qIn = basin.inflowNodeIds.reduce((s, id) => s - nodeOutflow(net, result, id), 0);
  return qIn - nodeOutflow(net, result, basin.nodeId);
}

/** Frames at t = 0, dt, 2·dt … durationS. Lazily solved, so a caller can stream them. */
export function* runScenario(model: ScenarioModel, events: ScenarioEvent[], opts: ScenarioOptions): Generator<ScenarioFrame> {
  const dt = opts.dt ?? 0.5;
  const base = model.network;
  const pumps = base.links.filter((l): l is PumpLink => l.kind === 'pump');
  const speeds: Record<string, number> = Object.fromEntries(pumps.map((p) => [p.id, p.speedRatio]));
  const openings: Record<string, number> = Object.fromEntries(
    base.links.flatMap((l) => (l.kind === 'valve' ? [[l.id, l.opening]] : [])),
  );
  const levels: Record<string, number> = Object.fromEntries(model.basins.map((b) => [b.nodeId, b.level]));
  const ramps = new Map<string, Ramp>();
  const coasting = new Set<string>();
  const pending = [...events].sort((a, b) => a.t - b.t);
  const rho = waterProperties(base.temperatureC).rho;

  for (let k = 0; ; k++) {
    const t = k * dt;

    while (pending.length && pending[0].t <= t + 1e-9) {
      const e = pending.shift()!;
      if (e.kind === 'pumpStart') {
        coasting.delete(e.id);
        ramps.set(e.id, { t0: e.t, T: e.rampS, from: speeds[e.id] ?? 0, to: model.nominalSpeed[e.id] ?? 1 });
      } else if (e.kind === 'pumpStop') {
        ramps.delete(e.id);
        coasting.add(e.id);
      } else {
        ramps.set(e.id, { t0: e.t, T: e.timeS, from: openings[e.id] ?? 1, to: e.target });
      }
    }
    for (const [id, r] of ramps) {
      if (id in speeds) speeds[id] = rampAt(r, t);
      else openings[id] = rampAt(r, t);
    }

    const network: PipelineNetwork = {
      ...base,
      nodes: base.nodes.map((n) => (n.id in levels ? { ...n, fixedHead: model.basins.find((b) => b.nodeId === n.id)!.floor + levels[n.id] } : n)),
      links: base.links.map((l) =>
        l.kind === 'pump' ? { ...l, speedRatio: speeds[l.id] } : l.kind === 'valve' ? { ...l, opening: openings[l.id] } : l,
      ),
    };
    const result = solveSteadyState(network);
    yield { t, result, levels: { ...levels }, speeds: { ...speeds }, openings: { ...openings } };
    if (t >= opts.durationS - 1e-9) return;

    // Advance the state over [t, t + dt] on this step's flows.
    for (const b of model.basins) levels[b.nodeId] += (dt * basinNetInflow(network, result, b)) / b.area;
    for (const id of coasting) {
      // Tripped rotor: I·dω/dt = −P_shaft/ω. Shaft power, not ρgQH/η, so a
      // rotor behind a shut check valve still brakes on its churn torque.
      const p = pumps.find((x) => x.id === id)!;
      const omegaR = (p.spec.ratedRpm * 2 * Math.PI) / 60;
      const n = speeds[id];
      if (n <= 0) continue;
      const torque = pumpShaftPower(p.spec, result.links.get(id)?.flow ?? 0, n, rho) / (n * omegaR);
      speeds[id] = Math.max(0, n - (torque * dt) / (p.spec.inertia * omegaR));
    }
  }
}
