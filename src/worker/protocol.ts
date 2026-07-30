/**
 * Message protocol between the main thread and the simulation worker.
 *
 * In Phase 1 the worker only runs the steady-state solve. The protocol is
 * shaped to grow: transient commands (valve trajectories, pump trips) and the
 * SharedArrayBuffer field stream will slot in as new message types without
 * changing the request/response envelope.
 */

import { PipelineNetwork } from '../domain/network';
import { PumpHealth } from '../analysis/pumpHealth';
import { WaterHammerConfig } from '../physics/transient';

export interface SolveSteadyRequest {
  type: 'SOLVE_STEADY';
  requestId: number;
  network: PipelineNetwork;
}

export interface PingRequest {
  type: 'PING';
  requestId: number;
}

/**
 * Start a transient (water hammer) run. The worker steps the MOC solver on a
 * fixed cadence and streams pressure frames back until it reaches the run
 * duration or a STOP arrives. `stepsPerFrame` sets the slow-motion factor.
 */
export interface StartTransientRequest {
  type: 'START_TRANSIENT';
  requestId: number;
  config: WaterHammerConfig;
  /** Valve closure time [s]; the valve ramps tau 1->0 over this interval. */
  closureTime: number;
  /** MOC steps advanced per streamed frame (higher = faster playback). */
  stepsPerFrame: number;
  /** Number of wave periods (4L/a) to simulate before stopping. */
  periods: number;
}

export interface StopTransientRequest {
  type: 'STOP_TRANSIENT';
  requestId: number;
}

/** Run a time-domain (water hammer) analysis on an arbitrary built network. */
export interface StartNetTransientRequest {
  type: 'START_NET_TRANSIENT';
  requestId: number;
  network: PipelineNetwork;
  /** Valve link id to close (the surge trigger), or null. */
  valveId: string | null;
  /** Pump link id to trip (power failure), or null. */
  pumpTripId: string | null;
  closureTime: number;
  stepsPerFrame: number;
  seconds: number;
}

export type WorkerRequest =
  | SolveSteadyRequest
  | PingRequest
  | StartTransientRequest
  | StopTransientRequest
  | StartNetTransientRequest;

/** A non-"ok" engineering finding from analysis/report.ts's generateReport
 * (ASME B31.3 hoop stress, API RP 14E erosion, NPSH margin, valve
 * cavitation). Purely informational for the UI — unlike the structural
 * ValidationIssue list, it never blocks re-solving. */
export interface SolveFinding {
  severity: 'error' | 'warning';
  message: string;
  ref?: string;
}

export interface SolveSteadyResponse {
  type: 'SOLVE_STEADY_RESULT';
  requestId: number;
  converged: boolean;
  iterations: number;
  residual: number;
  /** Node id -> total head [m]. */
  heads: Array<[string, number]>;
  /** Link id -> { flow, velocity, headLoss }. */
  links: Array<[string, { flow: number; velocity: number; headLoss: number }]>;
  findings: SolveFinding[];
  /** Per-pump condition (duty point, suction, churn) — plain data, so it
   *  crosses the worker boundary as-is. */
  pumps: PumpHealth[];
}

export interface PongResponse {
  type: 'PONG';
  requestId: number;
}

export interface ErrorResponse {
  type: 'ERROR';
  requestId: number;
  message: string;
}

/**
 * One streamed transient frame. `head` is the head [m] at every node along the
 * pipe; `maxEnvelope`/`minEnvelope` are the running per-node extremes (the
 * worst-case pressure profile). Buffers are transferred, not copied.
 */
export interface TransientFrame {
  type: 'TRANSIENT_FRAME';
  requestId: number;
  time: number;
  tau: number;
  head: Float32Array;
  maxEnvelope: Float32Array;
  minEnvelope: Float32Array;
  /** Vapor cavity volume [m^3] at each node (0 = intact liquid). */
  cavity: Float32Array;
  valveHead: number;
  reservoirHead: number;
  joukowsky: number;
  wavePeriod: number;
  /** Peak cavity volume seen anywhere over the whole run [m^3]. */
  peakCavity: number;
  done: boolean;
}

/**
 * One streamed network-transient frame. `heads` is in node order, `flows` in
 * pipe-link order (the caller maps them back to ids via the network it sent).
 */
export interface NetTransientFrame {
  type: 'NET_TRANSIENT_FRAME';
  requestId: number;
  time: number;
  heads: Float32Array;
  flows: Float32Array;
  minHead: number;
  maxHead: number;
  peakSurge: number;
  /** Speed ratio of the tripped pump (1 = rated, 0 = stopped; 1 if none). */
  pumpSpeed: number;
  done: boolean;
}

export type WorkerResponse =
  | SolveSteadyResponse
  | PongResponse
  | ErrorResponse
  | TransientFrame
  | NetTransientFrame;
