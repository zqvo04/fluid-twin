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
import { rotorBrakingTorque } from '../domain/catalog/pumps';
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
  /** Basins run dry this step: the pumps drawing on them have lost prime. */
  dryBasins: string[];
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

/**
 * Pumps that draw on `nodeId`: reached from it through pipes and valves on
 * their suction side (not through another pump).
 */
function suctionPumps(net: PipelineNetwork, nodeId: string): string[] {
  const seen = new Set([nodeId]);
  const queue = [nodeId];
  const pumps: string[] = [];
  while (queue.length) {
    const at = queue.pop()!;
    for (const l of net.links) {
      if (l.kind === 'pump') {
        if (l.from === at && !pumps.includes(l.id)) pumps.push(l.id);
        continue;
      }
      for (const [a, b] of [[l.from, l.to], [l.to, l.from]]) {
        if (a === at && !seen.has(b)) {
          seen.add(b);
          queue.push(b);
        }
      }
    }
  }
  return pumps;
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

    // Pumps in `unprimed` draw air from a dry basin: no head and no liquid,
    // i.e. a blocked line (speed 0 to the solver) while their motor turns on.
    const build = (unprimed: Set<string>): PipelineNetwork => ({
      ...base,
      nodes: base.nodes.map((n) => (n.id in levels ? { ...n, fixedHead: model.basins.find((b) => b.nodeId === n.id)!.floor + levels[n.id] } : n)),
      links: base.links.map((l) =>
        l.kind === 'pump'
          ? { ...l, speedRatio: unprimed.has(l.id) ? 0 : speeds[l.id] }
          : l.kind === 'valve'
            ? { ...l, opening: openings[l.id] }
            : l,
      ),
    });
    let network = build(new Set());
    let result = solveSteadyState(network);
    // Pumps lose prime when this step would draw their basin below empty —
    // checked ahead, so the step never overdraws (mass is conserved exactly)
    // and a refilling basin stays a free surface. A real pump also loses
    // prime just before the basin is bone dry (air drawn in at low submergence).
    const dry = model.basins.filter((b) => levels[b.nodeId] + (dt * basinNetInflow(network, result, b)) / b.area < 0);
    if (dry.length) {
      network = build(new Set(dry.flatMap((b) => suctionPumps(base, b.nodeId))));
      result = solveSteadyState(network);
    }
    yield { t, result, levels: { ...levels }, speeds: { ...speeds }, openings: { ...openings }, dryBasins: dry.map((b) => b.nodeId) };
    if (t >= opts.durationS - 1e-9) return;

    // Advance the state over [t, t + dt] on this step's flows.
    for (const b of model.basins) levels[b.nodeId] += (dt * basinNetInflow(network, result, b)) / b.area;
    for (const id of coasting) {
      // Tripped rotor: I·dω/dt = −T_brake (fluid churn + bearing/seal drag).
      const p = pumps.find((x) => x.id === id)!;
      const omegaR = (p.spec.ratedRpm * 2 * Math.PI) / 60;
      const n = speeds[id];
      if (n <= 0) continue;
      const torque = rotorBrakingTorque(p.spec, result.links.get(id)?.flow ?? 0, n, rho);
      speeds[id] = Math.max(0, n - (torque * dt) / (p.spec.inertia * omegaR));
    }
  }
}
