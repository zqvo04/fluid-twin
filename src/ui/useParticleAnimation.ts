/**
 * Runs the flow-particle animation on its own rAF loop, independent of the
 * tile canvas's on-demand redraw. Particle state lives in refs (not React
 * state) so 60fps stepping never triggers a re-render.
 */

import { RefObject, useEffect, useRef } from 'react';
import { useAppStore } from './store';
import { buildFlowGraph, spawnParticle, stepParticles, Particle, FlowGraph, LinkFlow } from '../sim/particles';
import { buildLinkGeometries, LinkGeometry } from '../sim/linkGeometry';
import { drawParticles } from '../render/fluidLayer';

const MAX_DT = 0.05; // clamp long frame gaps (tab backgrounded, etc.)

export function useParticleAnimation(canvasRef: RefObject<HTMLCanvasElement>) {
  const grid = useAppStore((s) => s.grid);
  const compiled = useAppStore((s) => s.compiled);
  const result = useAppStore((s) => s.result);
  const showFlow = useAppStore((s) => s.showFlow);

  const particlesRef = useRef<Particle[]>([]);
  const graphRef = useRef<FlowGraph | null>(null);
  const flowsRef = useRef<Map<string, LinkFlow>>(new Map());
  const geometriesRef = useRef<Map<string, LinkGeometry>>(new Map());

  // Rebuild the flow graph/geometry/particle pool whenever the solved
  // network changes shape or the solve result updates.
  useEffect(() => {
    if (!showFlow || !result || !result.converged) {
      particlesRef.current = [];
      graphRef.current = null;
      return;
    }
    const flows = new Map<string, LinkFlow>();
    for (const [id, r] of result.links) flows.set(id, { flow: r.flow, velocity: r.velocity });

    const graph = buildFlowGraph(compiled.network, flows);
    const geometries = buildLinkGeometries(grid, compiled);
    flowsRef.current = flows;
    graphRef.current = graph;
    geometriesRef.current = geometries;

    const target = Math.min(600, Math.max(40, compiled.network.links.length * 15));
    const particles: Particle[] = [];
    for (let i = 0; i < target; i++) {
      const p = spawnParticle(graph, Math.random);
      if (p) particles.push(p);
    }
    particlesRef.current = particles;
  }, [grid, compiled, result, showFlow]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();

    const loop = (t: number) => {
      const dt = Math.min(MAX_DT, Math.max(0, (t - last) / 1000));
      last = t;

      const canvas = canvasRef.current;
      if (canvas) {
        const graph = graphRef.current;
        if (graph) {
          stepParticles(particlesRef.current, geometriesRef.current, graph, flowsRef.current, dt, Math.random);
        }
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const dpr = window.devicePixelRatio || 1;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          if (graph) {
            drawParticles(ctx, useAppStore.getState().view, particlesRef.current, geometriesRef.current);
          } else {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [canvasRef]);
}
