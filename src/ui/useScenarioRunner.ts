/**
 * Owns a worker for scenario playback (RUN_SCENARIO), separate from the
 * steady-state and surge workers so a running scenario never blocks them.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useAppStore } from './store';
import { WorkerRequest, WorkerResponse } from '../worker/protocol';
import { ScenarioEvent } from '../grid/types';
import { networkEvents, scenarioModel } from '../grid/scenario';

export function useScenarioRunner() {
  const workerRef = useRef<Worker | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const worker = new Worker(new URL('../worker/simulation.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.requestId !== requestId.current) return;
      if (msg.type === 'SCENARIO_FRAME') useAppStore.getState().pushFrame(msg.frame, msg.done);
      else if (msg.type === 'ERROR') useAppStore.getState().endPlayback();
    };
    return () => worker.terminate();
  }, []);

  /** Run `events` (tile ids) on the current grid for `durationS` seconds. */
  const start = useCallback((events: ScenarioEvent[], durationS: number) => {
    const { grid, compiled, beginPlayback } = useAppStore.getState();
    beginPlayback();
    const req: WorkerRequest = {
      type: 'RUN_SCENARIO',
      requestId: ++requestId.current,
      model: scenarioModel(grid, compiled),
      events: networkEvents(compiled, events),
      durationS,
      dt: 0.5,
      framesPerTick: 1,
    };
    workerRef.current?.postMessage(req);
  }, []);

  const stop = useCallback(() => {
    const req: WorkerRequest = { type: 'STOP_TRANSIENT', requestId: requestId.current };
    workerRef.current?.postMessage(req);
    useAppStore.getState().endPlayback();
  }, []);

  return { start, stop };
}
