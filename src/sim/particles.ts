/**
 * Flow particles: a visualization of the solved velocity field, not a
 * physical state of its own. Each particle is a parcel of fluid riding a
 * link's cell-space polyline; when it reaches a node it hands off to one of
 * the node's outflowing links, chosen with probability proportional to that
 * link's flow — so, averaged over many particles and many handoffs, the split
 * across a branch matches the flow split. A dead end (no outflow to hand off
 * to) respawns the particle somewhere else in the network, weighted the same
 * way, keeping the population constant.
 *
 * A particle is not a point on the centreline moving at bulk velocity. It
 * carries a lateral position across the bore, and its speed is the link's
 * bulk velocity modulated by the local flow field (flowProfile.ts): the
 * turbulent velocity profile across the section, and the jet through a
 * throttled valve's gap. That is what makes the stream shear, mix, and
 * visibly squeeze through a closing valve instead of sliding along like a
 * belt.
 *
 * Note what carries which signal. Particle *spacing* is even everywhere,
 * because a pipe carrying less flow is not emptier — it is full of slower
 * fluid. The flow rate shows up as speed, streak length and brightness. Spend
 * a moment on `seedParticles` before changing that.
 */

import { PipelineNetwork } from '../domain/network';
import { LinkGeometry, pointAtFraction, pointAndTangentAtFraction, CellPoint } from './linkGeometry';
import { mixLateral, profileSpeedFactor, throatContraction, throatSpeedFactor } from './flowProfile';

export interface LinkFlow {
  /** Signed flow [m^3/s] in the link's own from->to direction. */
  flow: number;
  /** Signed bulk velocity [m/s], same sign convention as flow. NaN for pumps. */
  velocity: number;
  /**
   * Effective open flow-area fraction (1 = full bore; a throttled valve is
   * lower). Drives the vena-contracta jet — see flowProfile.ts. Optional so
   * callers that only have solver output still work; absent reads as 1.
   */
  openFraction?: number;
}

export interface Particle {
  linkId: string;
  /** Position along the link's own from->to direction, 0..1. */
  s: number;
  /** Current travel direction in s: +1 toward `to`, -1 toward `from`. */
  dir: 1 | -1;
  /** Lateral position across the bore: 0 = centreline, ±1 = wall. */
  u: number;
  /**
   * Seconds since this particle appeared, used to fade it in. A particle that
   * blinked into existence at full brightness reads as a glitch; a particle
   * that fades up over a fraction of a second reads as fluid arriving.
   */
  age: number;
}

/** Seconds a newly (re)spawned particle takes to reach full opacity. */
export const FADE_IN_S = 0.35;

/**
 * Position along the link as the *flow* sees it: 0 where fluid enters, 1
 * where it leaves. A link's stored from->to orientation is bookkeeping and
 * can run against the actual flow (a valve dropped into a left-to-right line
 * routinely solves to a negative flow), so anything with an upstream/
 * downstream asymmetry — the way a jet builds fast and decays slowly — has to
 * be evaluated here rather than on the raw `s`.
 */
function flowwiseS(particle: Particle): number {
  return particle.dir > 0 ? particle.s : 1 - particle.s;
}

/**
 * Local physical speed [m/s] of one particle: the link's bulk velocity,
 * modulated by where the particle sits in the velocity profile and how far
 * into a valve's gap it is.
 *
 * This is the quantity the renderer scales brightness and streak length
 * against, deliberately in real units rather than relative to whatever else
 * is on the board. Normalising against the scene would keep a line looking
 * equally lively after its valve was shut to a trickle, because everything in
 * the scene slowed down together — the absolute scale is what makes "this
 * whole line has almost stopped" visible.
 */
export function particleSpeed(particle: Particle, flow: LinkFlow): number {
  if (!Number.isFinite(flow.velocity)) return 0;
  return (
    Math.abs(flow.velocity) *
    profileSpeedFactor(particle.u) *
    throatSpeedFactor(flow.openFraction ?? 1, flowwiseS(particle))
  );
}

/** The same speed expressed as board motion [cells/s], for integrating position. */
export function particleCellsPerSecond(particle: Particle, flow: LinkFlow, cellSize: number): number {
  if (cellSize <= 0) return 0;
  return particleSpeed(particle, flow) / cellSize;
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
  return {
    linkId: choice.linkId,
    s: choice.enterS === 0 ? rand() * 0.05 : 1 - rand() * 0.05,
    dir: choice.dir,
    // Uniform across the bore: on a side view of a pipe, a uniformly filled
    // cross-section projects to a uniform spread of lateral offsets.
    u: rand() * 2 - 1,
    age: 0,
  };
}

/**
 * Seed a fresh population spread evenly along the drawn network.
 *
 * Even *linear density* is the physically correct answer, and it is also the
 * steady state the handoff dynamics settle into on their own: particles enter
 * a link at a rate proportional to Q and dwell there for L/V, so occupancy
 * lands at Q · L/V = A·L — the link's volume. A pipe carrying less flow is not
 * emptier than one carrying more; it is fuller of *slower* fluid. The flow
 * rate is what the streaks' speed and brightness show, not what their spacing
 * shows.
 *
 * Seeding matches that steady state directly so the field looks right the
 * instant a solve lands, instead of visibly re-sorting itself for a few
 * seconds afterwards.
 */
export function seedParticles(
  graph: FlowGraph,
  geometries: Map<string, LinkGeometry>,
  count: number,
  rand: () => number,
): Particle[] {
  const byLength: Choice[] = graph.allChoices.map((c) => ({
    ...c,
    weight: geometries.get(c.linkId)?.cellLength ?? 0,
  }));

  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const choice = weightedPick(byLength, rand());
    if (!choice) break;
    particles.push({
      linkId: choice.linkId,
      s: rand(),
      dir: choice.dir,
      u: rand() * 2 - 1,
      // Stagger the fade-in so a fresh population arrives as a wash rather
      // than as one synchronized flash.
      age: rand() * FADE_IN_S,
    });
  }
  return particles;
}

/**
 * How many particles to draw per cell of pipe. Sizing the pool by the length
 * of the network — rather than fixing a total — keeps the *density* constant,
 * so a big plant does not animate more thinly than a short line.
 *
 * Set generously because the sparsest place on the board is the one that most
 * needs to stay legible: a parcel of fluid spends proportionally less time in
 * a valve's gap than anywhere else (it is moving several times faster there),
 * so the jet correctly draws as fewer, longer streaks — and at a low density
 * "fewer" rounds down to an empty tile.
 */
export const PARTICLES_PER_CELL = 9;

/** Particle budget for a network, from its total drawn length. */
export function particleBudget(geometries: Map<string, LinkGeometry>, min = 40, max = 1600): number {
  let cells = 0;
  for (const g of geometries.values()) cells += g.cellLength;
  return Math.max(min, Math.min(max, Math.round(cells * PARTICLES_PER_CELL)));
}

/** Handoffs chased in one step, so a very fast particle crossing a very short
 *  link can't loop forever inside a single frame. */
const MAX_HANDOFFS_PER_STEP = 4;

/**
 * Advance every particle by `dtSeconds`, handing off or respawning at link
 * ends. `cellSize` converts the solved velocities [m/s] into board motion.
 *
 * Motion is integrated in *cells travelled*, not in link fractions, so that
 * distance left over at the end of a link carries into the next one. Dropping
 * that remainder (and re-entering at exactly the link's start) is what made
 * particles hesitate at every junction.
 */
export function stepParticles(
  particles: Particle[],
  geometries: Map<string, LinkGeometry>,
  graph: FlowGraph,
  flows: Map<string, LinkFlow>,
  dtSeconds: number,
  rand: () => number,
  cellSize = 1,
): void {
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    p.age += dtSeconds;

    let geo = geometries.get(p.linkId);
    let lf = flows.get(p.linkId);
    if (!geo || !lf || !Number.isFinite(lf.velocity)) {
      const replacement = spawnParticle(graph, rand);
      if (replacement) particles[i] = replacement;
      continue;
    }

    // Direction follows the link's *current* flow sign, so a reversal (e.g.
    // a valve swapping upstream/downstream) turns the particle around.
    p.dir = lf.flow >= 0 ? 1 : -1;

    let remaining = particleCellsPerSecond(p, lf, cellSize) * dtSeconds;
    let moved = 0;

    for (let hop = 0; hop <= MAX_HANDOFFS_PER_STEP; hop++) {
      // Cells left before this particle runs off the end it is heading for.
      const toEnd = (p.dir > 0 ? 1 - p.s : p.s) * geo.cellLength;
      if (remaining < toEnd || geo.cellLength <= 0) {
        p.s += (p.dir * remaining) / geo.cellLength;
        moved += remaining;
        break;
      }

      moved += toEnd;
      remaining -= toEnd;

      const ends = graph.linkEndpoints.get(p.linkId);
      const nodeId = ends ? (p.dir > 0 ? ends.to : ends.from) : null;
      const next = nodeId ? weightedPick(graph.outgoing.get(nodeId) ?? [], rand()) : null;
      if (!next) {
        // Dead end: this parcel of fluid has nowhere to go, so it re-enters
        // the flow-weighted lottery somewhere else rather than piling up.
        const replacement = spawnParticle(graph, rand);
        particles[i] = replacement ?? { ...p, s: 0.5 };
        moved = 0;
        break;
      }

      // Keep the lateral position through the junction — a parcel of fluid
      // does not jump across the bore just because the link id changed.
      p.linkId = next.linkId;
      p.s = next.enterS;
      p.dir = next.dir;
      const nextGeo = geometries.get(next.linkId);
      const nextFlow = flows.get(next.linkId);
      if (!nextGeo || !nextFlow) {
        const replacement = spawnParticle(graph, rand);
        if (replacement) particles[i] = replacement;
        moved = 0;
        break;
      }
      geo = nextGeo;
      lf = nextFlow;
    }

    // Clamp against accumulated floating-point drift at the ends.
    p.s = Math.max(0, Math.min(1, p.s));
    if (particles[i] === p) p.u = mixLateral(p.u, moved, rand);
  }
}

/** Current cell-space position of a particle along its link's centreline. */
export function particlePosition(particle: Particle, geometries: Map<string, LinkGeometry>): CellPoint | null {
  const geo = geometries.get(particle.linkId);
  if (!geo) return null;
  return pointAtFraction(geo.points, particle.s);
}

/** Everything the renderer needs about one particle this frame. */
export interface ParticleView {
  /** Centreline point at the particle's position. */
  point: CellPoint;
  /** Unit tangent in the direction of travel (cell space). */
  dCol: number;
  /** @see dCol */
  dRow: number;
  /** Lateral offset as a signed fraction of the bore radius, after any
   *  contraction through a valve gap. */
  offset: number;
  /** Local physical speed [m/s] — sets streak length and brightness. */
  speed: number;
  /** Fade-in opacity, 0..1. */
  fade: number;
}

export function particleView(
  particle: Particle,
  geometries: Map<string, LinkGeometry>,
  flows: Map<string, LinkFlow>,
): ParticleView | null {
  const geo = geometries.get(particle.linkId);
  const lf = flows.get(particle.linkId);
  if (!geo || !lf) return null;

  const { point, tCol, tRow } = pointAndTangentAtFraction(geo.points, particle.s);
  const open = lf.openFraction ?? 1;
  return {
    point,
    dCol: tCol * particle.dir,
    dRow: tRow * particle.dir,
    offset: particle.u * throatContraction(open, flowwiseS(particle)),
    speed: particleSpeed(particle, lf),
    fade: Math.min(1, particle.age / FADE_IN_S),
  };
}
