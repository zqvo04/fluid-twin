/**
 * Runs the flow-particle animation on its own rAF loop, independent of the
 * tile canvas's on-demand redraw. Particle state lives in refs (not React
 * state) so 60fps stepping never triggers a re-render.
 */

import { RefObject, useEffect, useRef } from 'react';
import { useAppStore } from './store';
import { useDisplayState } from './solved';
import {
  buildFlowGraph,
  spawnParticle,
  stepParticles,
  rebalanceOccupancy,
  REBALANCE_INTERVAL_S,
  Particle,
  FlowGraph,
  LinkFlow,
} from '../sim/particles';
import { buildLinkGeometries, fillPumpVelocities, LinkGeometry } from '../sim/linkGeometry';
import { drawParticles } from '../render/fluidLayer';

const MAX_DT = 0.05; // clamp long frame gaps (tab backgrounded, etc.)

export function useParticleAnimation(canvasRef: RefObject<HTMLCanvasElement>) {
  const grid = useAppStore((s) => s.grid);
  const compiled = useAppStore((s) => s.compiled);
  const showFlow = useAppStore((s) => s.showFlow);
  // Flows of the steady solve, or of the scenario frame being played back.
  const { solved } = useDisplayState();

  const particlesRef = useRef<Particle[]>([]);
  const graphRef = useRef<FlowGraph | null>(null);
  const flowsRef = useRef<Map<string, LinkFlow>>(new Map());
  const geometriesRef = useRef<Map<string, LinkGeometry>>(new Map());

  // Network the particle pool was seeded on (see below).
  const seededFor = useRef<typeof compiled | null>(null);

  // Rebuild the flow graph/geometry whenever the solved network changes shape
  // or the solve result updates. The particle pool itself is only re-seeded
  // when the network changes: scenario playback streams a new result ~40×/s,
  // and re-seeding on each would make the particles flicker instead of flow.
  useEffect(() => {
    if (!showFlow || !solved) {
      particlesRef.current = [];
      graphRef.current = null;
      seededFor.current = null;
      return;
    }
    const flows = new Map<string, LinkFlow>();
    for (const [id, r] of solved.links) flows.set(id, { flow: r.flow, velocity: r.velocity });
    fillPumpVelocities(grid, compiled, flows);

    const graph = buildFlowGraph(compiled.network, flows);
    const geometries = buildLinkGeometries(grid, compiled);
    flowsRef.current = flows;
    graphRef.current = graph;
    geometriesRef.current = geometries;

    if (seededFor.current === compiled && particlesRef.current.length) return;
    seededFor.current = compiled;
    const target = Math.min(600, Math.max(40, compiled.network.links.length * 15));
    const particles: Particle[] = [];
    for (let i = 0; i < target; i++) {
      const p = spawnParticle(graph, Math.random);
      if (p) particles.push(p);
    }
    particlesRef.current = particles;
  }, [grid, compiled, solved, showFlow]);

  const rebalanceAccum = useRef(0);

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
          rebalanceAccum.current += dt;
          if (rebalanceAccum.current >= REBALANCE_INTERVAL_S) {
            rebalanceAccum.current = 0;
            rebalanceOccupancy(particlesRef.current, graph, Math.random);
          }
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
