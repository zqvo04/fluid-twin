/**
 * Network graph — the single source of truth for the pipeline.
 *
 * Mathematically the network is a directed graph of nodes and links; visually
 * the same data drives the 3D scene. Node Y-coordinate is the physical
 * elevation used by the solver, so "what you assemble in 3D is what you
 * analyze". SubAssemblies group members (e.g. a pump skid) for reuse and for
 * the Global/Detail view switch.
 */

import { NominalSize, Schedule } from './catalog/pipes';
import { ValveType } from './catalog/valves';
import { FittingType } from './catalog/fittings';
import { PumpSpec } from './catalog/pumps';

export interface Vec3 {
  x: number;
  y: number; // elevation [m]
  z: number;
}

export type NodeType = 'junction' | 'reservoir';

export interface NetworkNode {
  id: string;
  type: NodeType;
  position: Vec3;
  /** Junction demand (outflow) [m^3/s]. Positive = water consumed. */
  demand?: number;
  /**
   * Reservoir total head [m]. If omitted, defaults to the node elevation
   * (free surface at grade). Gauge pressure head can be added here.
   */
  fixedHead?: number;
  /**
   * Plant section (area/unit) this node belongs to. Undefined = "Unassigned".
   * A link's section is derived from its `from` node, so tie-ins between
   * sections need not be stored — see domain/sections.ts.
   */
  sectionId?: string;
}

export interface PipeLink {
  id: string;
  kind: 'pipe';
  from: string;
  to: string;
  nps: NominalSize;
  schedule: Schedule;
  /** Centerline length [m]. Defaults to straight-line node distance if unset. */
  length?: number;
  /** Fittings along this run; their K values are summed as a minor loss. */
  fittings?: FittingType[];
}

export interface ValveLink {
  id: string;
  kind: 'valve';
  from: string;
  to: string;
  valveType: ValveType;
  nps: NominalSize;
  schedule: Schedule;
  /** Fractional opening 0 (closed) .. 1 (fully open). */
  opening: number;
}

/**
 * A pump. `from` is the suction node and `to` the discharge node — the
 * direction is physical, not a bookkeeping convention: a centrifugal pump
 * only produces head one way round.
 */
export interface PumpLink {
  id: string;
  kind: 'pump';
  from: string;
  to: string;
  spec: PumpSpec;
  /** Speed ratio relative to rated (1 = rated, VFD control < 1). */
  speedRatio: number;
  /** Discharge check valve fitted; absent reads as fitted (`hasCheckValve`). */
  checkValve?: boolean;
}

/** Whether a pump blocks reverse flow. Default (unset) is "fitted", which is
 *  what essentially every real pump installation has. Takes the tile or the
 *  link, so the editor and the solver read the default the same way. */
export const hasCheckValve = (pump: { checkValve?: boolean }): boolean => pump.checkValve !== false;

export type NetworkLink = PipeLink | ValveLink | PumpLink;

export interface SubAssembly {
  id: string;
  name: string;
  nodeIds: string[];
  linkIds: string[];
}

/**
 * A plant section (process area / unit) — a named, colored partition of the
 * network for the multi-view platform. Sections are a view + aggregation unit;
 * they do not change how the full-network solver runs. A section can be solved
 * on its own (fixed-head boundaries) for fast iteration — see domain/sections.ts.
 */
export interface PlantSection {
  id: string;
  name: string;
  /** Overlay tint (hex) used to color the section in the 3D scene. */
  color: string;
  description?: string;
}

export interface PipelineNetwork {
  nodes: NetworkNode[];
  links: NetworkLink[];
  subAssemblies: SubAssembly[];
  /**
   * Plant sections (areas). Optional for backward compatibility with v1
   * projects and fixtures; absent/empty = single unpartitioned plant. Read it
   * through `plantSections()` so callers never branch on undefined.
   */
  sections?: PlantSection[];
  /** Operating fluid temperature [C]. */
  temperatureC: number;
}

/** Plant sections of a network, normalized to an array. */
export function plantSections(net: PipelineNetwork): PlantSection[] {
  return net.sections ?? [];
}

export function emptyNetwork(temperatureC = 20): PipelineNetwork {
  return { nodes: [], links: [], subAssemblies: [], sections: [], temperatureC };
}

// --- Lookups & geometry helpers -----------------------------------------

export function nodeById(net: PipelineNetwork, id: string): NetworkNode {
  const n = net.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`Network node not found: ${id}`);
  return n;
}

export function distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Effective length of a pipe link (explicit override or straight-line). */
export function linkLength(net: PipelineNetwork, link: PipeLink): number {
  if (link.length !== undefined) return link.length;
  return distance(nodeById(net, link.from).position, nodeById(net, link.to).position);
}

// --- Validation ----------------------------------------------------------

export interface ValidationIssue {
  severity: 'error' | 'warning';
  message: string;
  ref?: string;
}

/**
 * Structural sanity checks run before analysis. Catches dangling links, size
 * mismatches at valve/pump connections, and networks with no fixed-head anchor
 * (which would leave the head field undetermined).
 */
export function validateNetwork(net: PipelineNetwork): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ids = new Set(net.nodes.map((n) => n.id));

  for (const link of net.links) {
    if (!ids.has(link.from)) {
      issues.push({ severity: 'error', message: `Link ${link.id} references missing node ${link.from}`, ref: link.id });
    }
    if (!ids.has(link.to)) {
      issues.push({ severity: 'error', message: `Link ${link.id} references missing node ${link.to}`, ref: link.id });
    }
    if (link.from === link.to) {
      issues.push({ severity: 'error', message: `Link ${link.id} connects a node to itself`, ref: link.id });
    }
  }

  const reservoirs = net.nodes.filter((n) => n.type === 'reservoir');
  if (reservoirs.length === 0) {
    issues.push({
      severity: 'error',
      message: 'Network has no reservoir / fixed-head node; the head field is undetermined.',
    });
  }

  return issues;
}
