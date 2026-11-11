/**
 * Grid domain model — the puzzle-piece layer the user actually edits.
 *
 * Every tile occupies exactly one grid cell (no per-tile "span"); a long pipe
 * run is just several `straight` tiles placed in a row. The compiler
 * (compile.ts) fuses consecutive straight/elbow tiles into a single
 * `PipeLink` with length = tile count * cellSize, so "variable length" comes
 * from chaining cells rather than from a length field on the tile — one
 * fewer piece of state to keep consistent with the grid.
 *
 * Row 0 is the top of the screen; row index maps to elevation via
 * `(rows - 1 - row) * cellSize`, so north (row - 1) is "up" both on screen
 * and physically, matching the existing domain model's `position.y =
 * elevation` convention.
 */

import { NominalSize, Schedule } from '../domain/catalog/pipes';
import { ValveType } from '../domain/catalog/valves';
import { PumpSpec } from '../domain/catalog/pumps';

export type Direction = 'N' | 'E' | 'S' | 'W';
export type Rotation = 0 | 90 | 180 | 270;

export interface Cell {
  col: number;
  row: number;
}

interface TileBase {
  id: string;
  cell: Cell;
  rotation: Rotation;
  nps: NominalSize;
  schedule: Schedule;
}

/**
 * A tile that is a piece of plant equipment (PFD item) rather than plain
 * piping. Carries the plant tag shown in PFD mode, e.g. `P-101A`. Format and
 * auto-assignment rules live in grid/tags.ts (P1-3); `id` stays the internal
 * key, `tag` is the human/plant identifier and must be unique per model.
 */
interface EquipmentBase extends TileBase {
  /** Plant tag `{type}-1{nn}{A|B}`, unit 100 fixed (PLAN-V2 §4.3 P1-3). */
  tag: string;
}

/** Pure pass-through, no direction change. Ports (rotation 0): E, W. */
export interface StraightTile extends TileBase {
  kind: 'straight';
}

/** Pure pass-through, 90-degree bend. Ports (rotation 0): N, E. */
export interface ElbowTile extends TileBase {
  kind: 'elbow';
}

/** Junction, no link of its own. Ports (rotation 0): W, E, S. */
export interface TeeTile extends TileBase {
  kind: 'tee';
}

/** Junction, no link of its own. Ports (rotation 0): N, E, S, W. */
export interface CrossTile extends TileBase {
  kind: 'cross';
}

/** A lumped element: two nodes (in/out) joined by a ValveLink. Ports: E, W. */
export interface ValveTile extends EquipmentBase {
  kind: 'valve';
  valveType: ValveType;
  /**
   * Plant role: 'control' = actuated control valve (tag FCV, stroked by
   * scenario events), 'manual' = hand valve (tag HV, e.g. the bypass).
   * Same hydraulics either way (V1 Cv curve).
   */
  service: 'control' | 'manual';
  /** Fractional opening 0 (closed) .. 1 (fully open). */
  opening: number;
}

/**
 * A lumped element: two nodes joined by a PumpLink. Unlike every other tile
 * its two ports are *not* interchangeable — port 0 (W at rotation 0) is the
 * suction the pump draws from, port 1 (E) the discharge it delivers to. See
 * ports.ts `pumpPorts`.
 */
export interface PumpTile extends EquipmentBase {
  kind: 'pump';
  spec: PumpSpec;
  speedRatio: number;
  /**
   * Discharge check valve fitted (the normal installation). Blocks reverse
   * flow through the pump. Optional so v1 projects load; absent reads as
   * fitted — see `hasCheckValve` in domain/network.ts.
   */
  checkValve?: boolean;
  /**
   * Motor energised. A stopped pump (standby B) is a blocked line, not a
   * free bypass — it compiles to speed 0, which the solver treats as such.
   * `speedRatio` is kept as the speed it runs at once started.
   */
  running: boolean;
}

/** Boundary node (reservoir, fixed head). Port: E. */
export interface SourceTile extends TileBase {
  kind: 'source';
  /** Fixed total head [m]. */
  head: number;
}

/** Boundary node (reservoir or fixed demand). Port: W. */
export interface SinkTile extends TileBase {
  kind: 'sink';
  mode: 'head' | 'demand';
  /** Used when mode === 'head': fixed total head [m]. */
  head: number;
  /** Used when mode === 'demand': fixed outflow [m^3/s]. */
  demand: number;
}

/**
 * Cooling-tower basin: open atmospheric tank, the loop's suction reservoir.
 * Water level h is a state variable integrated by the scenario timeline,
 * `area · dh/dt = Q_in − Q_out` (PLAN-V2 §2.1). Total head at the outlet =
 * floor elevation (this tile's `cellElevation`) + h; surface at atmosphere.
 * No make-up / blowdown. Port: E.
 */
export interface BasinTile extends EquipmentBase {
  kind: 'basin';
  /** Free-surface plan area A [m^2]; sets how fast the level moves. */
  area: number;
  /** Water level above the basin floor h [m]; initial value of the state. */
  level: number;
}

/**
 * Suction strainer: a lumped minor loss ΔH = K·V²/(2g), V = pipe velocity at
 * this tile's nps/schedule. K rises as the screen clogs (mapping K(clogging)
 * is compile-side, P1-2). Ports: E, W.
 */
export interface StrainerTile extends EquipmentBase {
  kind: 'strainer';
  /** Loss coefficient of the clean screen K_clean [-]. */
  kClean: number;
  /** Screen blockage fraction 0 (clean) .. 1 (fully blocked) [-]. */
  clogging: number;
}

/**
 * Heat exchanger, process (tube) side only — temperature is fixed, so it is a
 * pure quadratic resistance ΔP = k·Q², with k = designDp / designFlow²
 * fixed by one rated duty point (PLAN-V2 §2.1). Ports: E, W.
 */
export interface HxTile extends EquipmentBase {
  kind: 'hx';
  /** Rated flow Q_design [m^3/s]. */
  designFlow: number;
  /** Pressure drop at Q_design ΔP_design [Pa]. */
  designDp: number;
}

/**
 * Riser top + cooling-tower spray header: atmospheric discharge boundary.
 * Outlet elevation = this tile's `cellElevation`; jet exit loss K referenced
 * to the velocity head at this tile's nps/schedule. The discharged flow
 * re-enters `returnBasinId` (basin level mass balance). Port: W.
 */
export interface SprayTile extends EquipmentBase {
  kind: 'spray';
  /** Nozzle/header loss coefficient K [-] (incl. exit velocity head). */
  nozzleK: number;
  /** `id` of the BasinTile the sprayed water falls back into. */
  returnBasinId: string;
}

export type Tile =
  | StraightTile
  | ElbowTile
  | TeeTile
  | CrossTile
  | ValveTile
  | PumpTile
  | SourceTile
  | SinkTile
  | BasinTile
  | StrainerTile
  | HxTile
  | SprayTile;

export type TileKind = Tile['kind'];

/** Tiles that carry a plant `tag`. */
export type EquipmentTile = Extract<Tile, EquipmentBase>;

/**
 * ISA-5.1 instrument: a read-only probe bound to one element. No physics and
 * no cell — it is a model attribute, drawn as a bubble next to its target.
 *  - FI  flow indicator      → Q through the target [m^3/s]
 *  - PI  pressure indicator  → gauge pressure at the target [Pa]; on a
 *        two-node element (pump, valve, strainer, hx) it reads port 1
 *        (outlet/discharge) — place it on a pipe tile for another point
 *  - LI  level indicator     → basin level h [m]; target must be a basin
 *  - FIC flow indicating controller → reads like FI. V2 has no closed loop
 *        (FCV is stroked by scenario events), so FIC is display-only.
 * Values are produced only by readouts.ts (P1-4).
 */
export type InstrumentType = 'FI' | 'PI' | 'LI' | 'FIC';

export interface Instrument {
  /** Plant tag, e.g. `FI-101`; unique per model, doubles as the key. */
  tag: string;
  type: InstrumentType;
  /** `id` of the Tile this instrument reads. */
  targetId: string;
}

/**
 * Scenario timeline events (PLAN-V2 §2.2). `t` is the scenario time the event
 * fires [s]; `id` is the target Tile id. A scenario = events sorted by `t`.
 */
export type ScenarioEvent =
  /** Start a pump: speed ratio ramps 0 → 1 linearly over `rampS` [s]. */
  | { kind: 'pumpStart'; t: number; id: string; rampS: number }
  /** Trip a pump: motor torque removed, rotor coasts down on its inertia. */
  | { kind: 'pumpStop'; t: number; id: string }
  /**
   * Stroke a valve from its current opening to `target` (0..1 fraction)
   * linearly over `timeS` [s] — the actuator rate limit.
   */
  | { kind: 'valveStroke'; t: number; id: string; target: number; timeS: number };

export interface Scenario {
  name: string;
  events: ScenarioEvent[];
}

export interface GridModel {
  cols: number;
  rows: number;
  /** Physical size of one cell [m]; pipe run length = tile count * cellSize. */
  cellSize: number;
  tiles: Tile[];
  /** Instruments bound to tiles; they occupy no cell. */
  instruments: Instrument[];
  temperatureC: number;
}

export function emptyGrid(cols: number, rows: number, cellSize = 1, temperatureC = 20): GridModel {
  return { cols, rows, cellSize, tiles: [], instruments: [], temperatureC };
}

export function cellKey(cell: Cell): string {
  return `${cell.col},${cell.row}`;
}

export function sameCell(a: Cell, b: Cell): boolean {
  return a.col === b.col && a.row === b.row;
}

export function inBounds(grid: GridModel, cell: Cell): boolean {
  return cell.col >= 0 && cell.col < grid.cols && cell.row >= 0 && cell.row < grid.rows;
}

/** Physical elevation [m] of a cell's row, screen-top = highest. */
export function cellElevation(grid: GridModel, cell: Cell): number {
  return (grid.rows - 1 - cell.row) * grid.cellSize;
}
