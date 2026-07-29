/**
 * Owns the simulation worker and keeps the steady-state result in sync with
 * the compiled network: every edit posts a fresh SOLVE_STEADY request after
 * a short debounce (so dragging a slider doesn't spawn a solve per tick), and
 * a structurally invalid network (no reservoir, dangling links) is skipped
 * client-side rather than round-tripping to the worker just to error out.
 */

import { useEffect, useRef } from 'react';
import { useAppStore } from './store';
import { WorkerRequest, WorkerResponse } from '../worker/protocol';

const DEBOUNCE_MS = 120;

export function useAutoSolve() {
  const network = useAppStore((s) => s.compiled.network);
  const hasBlockingIssue = useAppStore((s) => s.issues.some((i) => i.severity === 'error'));
  const applyResult = useAppStore((s) => s.applyResult);
  const setSolving = useAppStore((s) => s.setSolving);
  const clearResult = useAppStore((s) => s.clearResult);

  const workerRef = useRef<Worker | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const worker = new Worker(new URL('../worker/simulation.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.type === 'SOLVE_STEADY_RESULT' && msg.requestId === requestId.current) {
        applyResult(msg);
      } else if (msg.type === 'ERROR') {
        setSolving(false);
      }
    };

    return () => worker.terminate();
  }, [applyResult, setSolving]);

  useEffect(() => {
    if (hasBlockingIssue || network.nodes.length === 0) {
      clearResult();
      return;
    }
    setSolving(true);
    const timer = setTimeout(() => {
      const worker = workerRef.current;
      if (!worker) return;
      const id = ++requestId.current;
      const req: WorkerRequest = { type: 'SOLVE_STEADY', requestId: id, network };
      worker.postMessage(req);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [network, hasBlockingIssue, setSolving, clearResult]);
}
