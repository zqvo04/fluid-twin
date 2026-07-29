/**
 * Flow particles: a visualization of the solved velocity field, not a
 * physical state of its own. Each particle rides a single link's cell-space
 * polyline at a rate set by that link's solved velocity; when it reaches a
 * node it hands off to one of the node's outflowing links, chosen with
 * probability proportional to that link's flow — so, averaged over many
 * particles and many handoffs, the split across a branch matches the flow
 * split. A dead end (no outflow to hand off to) respawns the particle
 * somewhere else in the network, weighted the same way, to keep the particle
 * count constant without biasing the flow-proportional distribution.
 */

import { PipelineNetwork } from '../domain/network';
import { LinkGeometry, pointAtFraction, CellPoint } from './linkGeometry';

export interface LinkFlow {
  /** Signed flow [m^3/s] in the link's own from->to direction. */
  flow: number;
  /** Signed bulk velocity [m/s], same sign convention as flow. NaN for pumps. */
  velocity: number;
}

export interface Particle {
  linkId: string;
  /** Position along the link's own from->to direction, 0..1. */
  s: number;
  /** Current travel direction in s: +1 toward `to`, -1 toward `from`. */
  dir: 1 | -1;
}

interface Choice {
  linkId: string;
  /** s to enter the link at, and the direction to travel from there. */
  enterS: number;
  dir: 1 | -1;
  weight: number;
}

export interface FlowGraph {
  /** node id -> weighted choices of an outflowing link to hand off to. */
  outgoing: Map<string, Choice[]>;
  /** Every link with non-negligible flow, weighted — used to respawn. */
  allChoices: Choice[];
  /** link id -> its node endpoints, for resolving a handoff after arrival. */
  linkEndpoints: Map<string, { from: string; to: string }>;
}

const MIN_FLOW = 1e-9;

export function buildFlowGraph(network: PipelineNetwork, flows: Map<string, LinkFlow>): FlowGraph {
  const outgoing = new Map<string, Choice[]>();
  const allChoices: Choice[] = [];
  const linkEndpoints = new Map<string, { from: string; to: string }>();

  const push = (nodeId: string, choice: Choice) => {
    if (!outgoing.has(nodeId)) outgoing.set(nodeId, []);
    outgoing.get(nodeId)!.push(choice);
  };

  for (const link of network.links) {
    linkEndpoints.set(link.id, { from: link.from, to: link.to });

    const lf = flows.get(link.id);
    if (!lf || !Number.isFinite(lf.flow) || Math.abs(lf.flow) < MIN_FLOW) continue;
    const weight = Math.abs(lf.flow);
    if (lf.flow > 0) {
      // Flow runs from -> to: this link is an outflow choice at `from`.
      const choice: Choice = { linkId: link.id, enterS: 0, dir: 1, weight };
      push(link.from, choice);
      allChoices.push(choice);
    } else {
      const choice: Choice = { linkId: link.id, enterS: 1, dir: -1, weight };
      push(link.to, choice);
      allChoices.push(choice);
    }
  }

  return { outgoing, allChoices, linkEndpoints };
}

export function weightedPick(choices: Choice[], rand: number): Choice | null {
  if (choices.length === 0) return null;
  let total = 0;
  for (const c of choices) total += c.weight;
  if (total < MIN_FLOW) return null;
  let target = rand * total;
  for (const c of choices) {
    target -= c.weight;
    if (target <= 0) return c;
  }
  return choices[choices.length - 1];
}

export function spawnParticle(graph: FlowGraph, rand: () => number): Particle | null {
  const choice = weightedPick(graph.allChoices, rand());
  if (!choice) return null;
  return { linkId: choice.linkId, s: choice.enterS === 0 ? rand() * 0.05 : 1 - rand() * 0.05, dir: choice.dir };
}

/** Advance every particle by `dtSeconds`, handing off or respawning at link ends. */
export function stepParticles(
  particles: Particle[],
  geometries: Map<string, LinkGeometry>,
  graph: FlowGraph,
  flows: Map<string, LinkFlow>,
  dtSeconds: number,
  rand: () => number,
): void {
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const geo = geometries.get(p.linkId);
    const lf = flows.get(p.linkId);
    if (!geo || !lf || !Number.isFinite(lf.velocity)) {
      const replacement = spawnParticle(graph, rand);
      if (replacement) particles[i] = replacement;
      continue;
    }

    // Direction follows the link's *current* flow sign, so a reversal (e.g.
    // a valve swapping upstream/downstream) turns the particle around.
    p.dir = lf.flow >= 0 ? 1 : -1;

    const speed = Math.abs(lf.velocity) / geo.physicalLength; // ds/dt
    p.s += p.dir * speed * dtSeconds;

    if (p.s >= 1 || p.s <= 0) {
      const ends = graph.linkEndpoints.get(p.linkId);
      const nodeId = ends ? (p.s >= 1 ? ends.to : ends.from) : null;
      const next = nodeId ? weightedPick(graph.outgoing.get(nodeId) ?? [], rand()) : null;
      if (next) {
        particles[i] = { linkId: next.linkId, s: next.enterS, dir: next.dir };
      } else {
        const replacement = spawnParticle(graph, rand);
        particles[i] = replacement ?? { linkId: p.linkId, s: 0.5, dir: p.dir };
      }
    }
  }
}

/** Current cell-space position of a particle along its link's polyline. */
export function particlePosition(particle: Particle, geometries: Map<string, LinkGeometry>): CellPoint | null {
  const geo = geometries.get(particle.linkId);
  if (!geo) return null;
  return pointAtFraction(geo.points, particle.s);
}
