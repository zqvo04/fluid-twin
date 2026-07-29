/**
 * Owns a dedicated worker for the water-hammer (MOC) transient run, separate
 * from useAutoSolve's steady-state worker so a long-running streamed
 * analysis never contends with the debounced steady solve.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useAppStore } from './store';
import { WorkerRequest, WorkerResponse } from '../worker/protocol';

export function useTransientRunner() {
  const workerRef = useRef<Worker | null>(null);
  const requestId = useRef(0);
  const nodeIdsRef = useRef<string[]>([]);
  const pushTransientFrame = useAppStore((s) => s.pushTransientFrame);

  useEffect(() => {
    const worker = new Worker(new URL('../worker/simulation.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.type === 'NET_TRANSIENT_FRAME' && msg.requestId === requestId.current) {
        pushTransientFrame(msg, nodeIdsRef.current);
      } else if (msg.type === 'ERROR') {
        useAppStore.getState().endTransientRun();
      }
    };

    return () => worker.terminate();
  }, [pushTransientFrame]);

  const start = useCallback((opts: { valveId?: string; pumpTripId?: string }) => {
    const { compiled, transient } = useAppStore.getState();
    nodeIdsRef.current = compiled.network.nodes.map((n) => n.id);
    const id = ++requestId.current;
    useAppStore.getState().beginTransientRun();
    const req: WorkerRequest = {
      type: 'START_NET_TRANSIENT',
      requestId: id,
      network: compiled.network,
      valveId: opts.valveId ?? null,
      pumpTripId: opts.pumpTripId ?? null,
      closureTime: transient.closureTimeS,
      stepsPerFrame: 4,
      seconds: transient.seconds,
    };
    workerRef.current?.postMessage(req);
  }, []);

  const stop = useCallback(() => {
    const req: WorkerRequest = { type: 'STOP_TRANSIENT', requestId: requestId.current };
    workerRef.current?.postMessage(req);
    useAppStore.getState().endTransientRun();
  }, []);

  return { start, stop };
}
