/**
 * Pump condition analysis — what the machine is being put through at the duty
 * point the solver found, not just whether the numbers balance.
 *
 * Four distinct ways a centrifugal pump is abused, all of which this reports:
 *
 *  - **Churn / deadhead (공회전).** Running against a shut discharge. The
 *    impeller still absorbs roughly half its BEP shaft power, but no liquid
 *    leaves to carry that energy away, so all of it heats the few tens of
 *    litres trapped in the casing. Small pumps reach flashing in minutes; the
 *    seal faces go first. Quantified here as a casing temperature-rise rate
 *    and a time to an allowable rise.
 *  - **Dry running.** The suction cannot keep the eye fed at all (NPSHa
 *    collapsed, or the pump is trying to lift more than ambient pressure can
 *    push). Head goes to zero, and with no liquid there is nothing to cool or
 *    lubricate the seal — the fastest way to destroy a pump.
 *  - **Cavitation.** NPSHa below NPSHr: vapor bubbles form at the eye and
 *    implode on the vanes. Head degrades and the impeller erodes.
 *  - **Off-BEP operation.** Below ~70% BEP the flow recirculates inside the
 *    impeller and the shaft sees an unbalanced radial load; above ~120% the
 *    motor and the NPSH margin run out. (Hydraulic Institute guidance.)
 *
 * Pure functions over the solved network — no rendering or UI concerns.
 */

import { G } from '../domain/units';
import { FluidState } from '../domain/fluid';
import { PipelineNetwork, nodeById } from '../domain/network';
import {
  DRY_SUCTION_FACTOR,
  casingVolume,
  churnTempRiseRate,
  npshAvailable,
  pumpNpshRequired,
  pumpShaftPower,
  suctionHeadFactor,
  thermalMinimumFlow,
} from '../domain/catalog/pumps';

/** Minimal result shape shared by the solver output and the UI's stored result. */
export interface HealthResultView {
  heads: Map<string, number>;
  links: Map<string, { flow: number; velocity: number; headLoss: number }>;
}

export type PumpState = 'stopped' | 'dry-run' | 'churn' | 'cavitating' | 'overload' | 'low-flow' | 'ok';

export interface PumpHealth {
  linkId: string;
  pumpName: string;
  /** Speed ratio actually commanded (1 = rated). */
  speedRatio: number;
  /** Duty flow [m^3/s], positive suction -> discharge. */
  flow: number;
  bepFlow: number;
  /** flow / bepFlow. */
  bepRatio: number;
  /** Head actually delivered, discharge minus suction [m]. */
  head: number;
  /** Gauge head at the suction / discharge nodes [m]. */
  suctionGaugeHead: number;
  dischargeGaugeHead: number;
  npshAvailable: number;
  npshRequired: number;
  /** npshAvailable - npshRequired [m]; negative means cavitating. */
  npshMargin: number;
  /** Fraction of curve head the suction condition still allows (0..1). */
  suctionFactor: number;
  /** Shaft power absorbed [W] and the part of it dumped into the liquid [W]. */
  shaftPower: number;
  heatPower: number;
  /** Casing temperature rise [K/s] with no throughflow to carry heat away. */
  tempRiseRate: number;
  /** Throughflow needed to hold the rise to CHURN_ALLOWABLE_RISE_K [m^3/s]. */
  minThermalFlow: number;
  /** Seconds of churn before the casing liquid gains CHURN_ALLOWABLE_RISE_K. */
  secondsToTempLimit: number;
  state: PumpState;
  /** 0 (healthy) .. 1 (being destroyed) — drives the UI's stress indicator. */
  stress: number;
  message: string;
}

/** Below this speed ratio the pump is off, not running badly. */
const STOPPED_SPEED = 0.02;
/** Below this fraction of BEP flow the pump is churning, not just throttled. */
const CHURN_FRACTION = 0.1;
/** Hydraulic Institute preferred operating region. */
const LOW_LIMIT = 0.7;
const HIGH_LIMIT = 1.2;
/** Ratio at which overload stress is considered total. */
const OVERLOAD_MAX = 1.6;
/** Allowable casing temperature rise before churn damage [K]. */
export const CHURN_ALLOWABLE_RISE_K = 15;

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

function describe(h: Omit<PumpHealth, 'message'>, casingLitres: number): string {
  const pct = (h.bepRatio * 100).toFixed(0);
  switch (h.state) {
    case 'stopped':
      return 'Stopped — the idle impeller and its check valve block the line.';
    case 'dry-run':
      return `Running dry: NPSH available ${h.npshAvailable.toFixed(1)} m cannot feed the impeller (needs ${h.npshRequired.toFixed(1)} m). No head is produced and the seal has no liquid to cool it — stop the pump or flood the suction.`;
    case 'churn':
      return `Churning against a shut discharge at ${pct}% BEP: ${(h.shaftPower / 1000).toFixed(1)} kW goes into ${casingLitres.toFixed(0)} L of trapped liquid, heating it ${h.tempRiseRate.toFixed(2)} K/s — ${h.secondsToTempLimit.toFixed(0)} s to a ${CHURN_ALLOWABLE_RISE_K} K rise. Open the discharge, or run a minimum-flow line — ${(h.minThermalFlow * 3600).toFixed(1)} m³/h carries the heat away, though recirculation and vibration usually set a higher limit than the thermal one.`;
    case 'cavitating':
      return `Cavitating: NPSH available ${h.npshAvailable.toFixed(1)} m is ${Math.abs(h.npshMargin).toFixed(1)} m short of NPSH required ${h.npshRequired.toFixed(1)} m. Head is down to ${(h.suctionFactor * 100).toFixed(0)}% of the curve and the impeller is eroding.`;
    case 'overload':
      return `Running out on the curve at ${pct}% BEP — motor overload and NPSH margin both run out here.`;
    case 'low-flow':
      return `Low-flow operation at ${pct}% BEP — internal recirculation and unbalanced radial load on the shaft.`;
    default:
      return `Operating at ${pct}% BEP within the recommended 70-120% window.`;
  }
}

export function analyzePumpHealth(
  net: PipelineNetwork,
  result: HealthResultView,
  fluid: FluidState,
): PumpHealth[] {
  const out: PumpHealth[] = [];

  for (const link of net.links) {
    if (link.kind !== 'pump') continue;
    const r = result.links.get(link.id);
    if (!r) continue;

    const spec = link.spec;
    const n = link.speedRatio;
    const flow = r.flow;
    const bepFlow = spec.bepFlow;
    const bepRatio = bepFlow > 0 ? flow / bepFlow : NaN;

    const suctionNode = nodeById(net, link.from);
    const dischargeNode = nodeById(net, link.to);
    const suctionGaugeHead = (result.heads.get(link.from) ?? suctionNode.position.y) - suctionNode.position.y;
    const dischargeGaugeHead =
      (result.heads.get(link.to) ?? dischargeNode.position.y) - dischargeNode.position.y;
    const head = (result.heads.get(link.to) ?? 0) - (result.heads.get(link.from) ?? 0);

    const npshA = npshAvailable(suctionGaugeHead, fluid.rho, fluid.pv);
    const npshR = pumpNpshRequired(spec, flow);
    const running = n > STOPPED_SPEED;
    const suctionFactor = running ? suctionHeadFactor(npshA, npshR) : 1;

    const shaftPower = running ? pumpShaftPower(spec, flow, n, fluid.rho) : 0;
    // Whatever the shaft puts in that does not leave as useful hydraulic work
    // ends up as heat in the liquid still inside the casing.
    const hydraulicPower = fluid.rho * G * Math.abs(flow) * Math.max(0, head);
    const heatPower = Math.max(0, shaftPower - hydraulicPower);
    const tempRiseRate = churnTempRiseRate(spec, heatPower, fluid.rho);
    const minThermalFlow = thermalMinimumFlow(heatPower, fluid.rho, CHURN_ALLOWABLE_RISE_K);
    const secondsToTempLimit = tempRiseRate > 0 ? CHURN_ALLOWABLE_RISE_K / tempRiseRate : Infinity;

    // --- Classification and stress index -------------------------------
    const churning = running && Math.abs(bepRatio) < CHURN_FRACTION;
    const dry = running && suctionFactor <= DRY_SUCTION_FACTOR;
    const cavitating = running && suctionFactor < 1 && !dry;

    let state: PumpState = 'ok';
    let stress = 0;
    if (!running) {
      state = 'stopped';
    } else if (dry) {
      state = 'dry-run';
      stress = 1;
    } else if (churning) {
      state = 'churn';
      // Total at a hard deadhead, easing off as real flow appears.
      stress = clamp01((CHURN_FRACTION - Math.abs(bepRatio)) / CHURN_FRACTION);
      if (cavitating) stress = Math.max(stress, 1 - suctionFactor);
    } else if (cavitating) {
      state = 'cavitating';
      stress = clamp01(1 - suctionFactor);
    } else if (bepRatio > HIGH_LIMIT) {
      state = 'overload';
      stress = clamp01((bepRatio - HIGH_LIMIT) / (OVERLOAD_MAX - HIGH_LIMIT));
    } else if (bepRatio < LOW_LIMIT) {
      state = 'low-flow';
      // 0 at the 70% limit, 0.8 by the point churn takes over — off-BEP wear
      // is cumulative, not the immediate destruction churn and dry running are.
      stress = 0.8 * clamp01((LOW_LIMIT - bepRatio) / (LOW_LIMIT - CHURN_FRACTION));
    }

    const base: Omit<PumpHealth, 'message'> = {
      linkId: link.id,
      pumpName: spec.name,
      speedRatio: n,
      flow,
      bepFlow,
      bepRatio,
      head,
      suctionGaugeHead,
      dischargeGaugeHead,
      npshAvailable: npshA,
      npshRequired: npshR,
      npshMargin: npshA - npshR,
      suctionFactor,
      shaftPower,
      heatPower,
      tempRiseRate,
      minThermalFlow,
      secondsToTempLimit,
      state,
      stress,
    };
    out.push({ ...base, message: describe(base, casingVolume(spec) * 1000) });
  }

  return out;
}
