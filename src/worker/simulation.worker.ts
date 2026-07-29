/// <reference lib="webworker" />
/**
 * Simulation worker — runs hydraulic analysis off the main thread so the
 * render loop keeps 60 fps. Phase 1 handles the steady-state solve; the
 * transient (MOC) loop and SharedArrayBuffer field stream arrive in Phase 3.
 */

import { solveSteadyState } from '../physics/steadySolver';
import { WaterHammerSim } from '../physics/transient';
import { NetworkTransientSim } from '../physics/networkTransient';
import { generateReport, reportFindingsToUiFindings } from '../analysis/report';
import { WorkerRequest, WorkerResponse, StartTransientRequest, StartNetTransientRequest } from './protocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

// --- Transient run state (a single active run at a time) ------------------
let transientTimer: ReturnType<typeof setTimeout> | null = null;

function stopTransient() {
  if (transientTimer !== null) {
    clearTimeout(transientTimer);
    transientTimer = null;
  }
}

function runTransient(req: StartTransientRequest) {
  stopTransient();
  const sim = new WaterHammerSim(req.config);
  const joukowsky = sim.joukowskyHead();
  const period = sim.wavePeriod();
  const endTime = req.periods * period;
  const frameMs = 25;

  // Per-node running envelope of head extremes over the whole run.
  const maxEnv = Float32Array.from(sim.H);
  const minEnv = Float32Array.from(sim.H);
  let peakCavity = 0;

  const tick = () => {
    for (let k = 0; k < req.stepsPerFrame; k++) {
      const tau = req.closureTime > 0 ? Math.max(0, 1 - sim.time / req.closureTime) : 0;
      sim.step(tau);
      for (let i = 0; i < sim.nodes; i++) {
        if (sim.H[i] > maxEnv[i]) maxEnv[i] = sim.H[i];
        if (sim.H[i] < minEnv[i]) minEnv[i] = sim.H[i];
        if (sim.cavityVolume[i] > peakCavity) peakCavity = sim.cavityVolume[i];
      }
    }

    const done = sim.time >= endTime;
    const tauNow = req.closureTime > 0 ? Math.max(0, 1 - sim.time / req.closureTime) : 0;
    const head = Float32Array.from(sim.H);
    const maxCopy = Float32Array.from(maxEnv);
    const minCopy = Float32Array.from(minEnv);
    const cavity = Float32Array.from(sim.cavityVolume);
    const frame: WorkerResponse = {
      type: 'TRANSIENT_FRAME',
      requestId: req.requestId,
      time: sim.time,
      tau: tauNow,
      head,
      maxEnvelope: maxCopy,
      minEnvelope: minCopy,
      cavity,
      valveHead: sim.H[sim.nodes - 1],
      reservoirHead: req.config.reservoirHead,
      joukowsky,
      wavePeriod: period,
      peakCavity,
      done,
    };
    ctx.postMessage(frame, [head.buffer, maxCopy.buffer, minCopy.buffer, cavity.buffer]);

    if (done) {
      transientTimer = null;
    } else {
      transientTimer = setTimeout(tick, frameMs);
    }
  };

  transientTimer = setTimeout(tick, frameMs);
}

function runNetTransient(req: StartNetTransientRequest) {
  stopTransient();
  // Finer reaches for a smoother wave, but cap total steps via a dt floor.
  const sim = new NetworkTransientSim(req.network, 8, req.seconds / 1400);
  const initHeads = Float64Array.from(sim.nodeHead);
  const valve = req.valveId ? req.network.links.find((l) => l.id === req.valveId) : null;
  const opening0 = valve && valve.kind === 'valve' ? valve.opening : 1;
  if (req.pumpTripId) sim.tripPump(req.pumpTripId);
  const endTime = req.seconds;
  const frameMs = 25;
  let peakSurge = 0;

  const tick = () => {
    for (let k = 0; k < req.stepsPerFrame; k++) {
      if (req.valveId) {
        const factor = Math.max(0, 1 - sim.time / req.closureTime);
        sim.setValveOpening(req.valveId, opening0 * factor);
      }
      sim.step();
      for (let i = 0; i < sim.nodeCount; i++) {
        const s = sim.nodeHead[i] - initHeads[i];
        if (s > peakSurge) peakSurge = s;
      }
    }

    const heads = Float32Array.from(sim.nodeHead);
    const flows = Float32Array.from(sim.pipeIds.map((id) => sim.pipeFlow(id)));
    let minHead = Infinity;
    let maxHead = -Infinity;
    for (let i = 0; i < heads.length; i++) {
      if (heads[i] < minHead) minHead = heads[i];
      if (heads[i] > maxHead) maxHead = heads[i];
    }
    const done = sim.time >= endTime;
    const frame: WorkerResponse = {
      type: 'NET_TRANSIENT_FRAME',
      requestId: req.requestId,
      time: sim.time,
      heads,
      flows,
      minHead,
      maxHead,
      peakSurge,
      pumpSpeed: req.pumpTripId ? sim.pumpSpeed(req.pumpTripId) : 1,
      done,
    };
    ctx.postMessage(frame, [heads.buffer, flows.buffer]);
    transientTimer = done ? null : setTimeout(tick, frameMs);
  };
  transientTimer = setTimeout(tick, frameMs);
}

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;

  try {
    switch (msg.type) {
      case 'PING': {
        const res: WorkerResponse = { type: 'PONG', requestId: msg.requestId };
        ctx.postMessage(res);
        break;
      }
      case 'START_TRANSIENT': {
        runTransient(msg);
        break;
      }
      case 'START_NET_TRANSIENT': {
        runNetTransient(msg);
        break;
      }
      case 'STOP_TRANSIENT': {
        stopTransient();
        break;
      }
      case 'SOLVE_STEADY': {
        const result = solveSteadyState(msg.network);
        // Engineering findings (hoop stress, erosion, NPSH, valve cavitation)
        // are only meaningful on a converged solve — a diverged result's
        // flows/heads aren't physical, so surfacing "violations" from them
        // would be noise, not signal.
        const findings = result.converged
          ? reportFindingsToUiFindings(generateReport(msg.network, result, result.fluid).findings)
          : [];
        const res: WorkerResponse = {
          type: 'SOLVE_STEADY_RESULT',
          requestId: msg.requestId,
          converged: result.converged,
          iterations: result.iterations,
          residual: result.residual,
          heads: Array.from(result.heads.entries()),
          links: Array.from(result.links.entries()).map(([id, r]) => [
            id,
            { flow: r.flow, velocity: r.velocity, headLoss: r.headLoss },
          ]),
          findings,
        };
        ctx.postMessage(res);
        break;
      }
    }
  } catch (err) {
    const res: WorkerResponse = {
      type: 'ERROR',
      requestId: msg.requestId,
      message: err instanceof Error ? err.message : String(err),
    };
    ctx.postMessage(res);
  }
};
