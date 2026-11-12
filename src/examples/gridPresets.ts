/**
 * Starter grid layouts for the "예제" menu — a quick way to see a working
 * network (and the pressure/flow visualization) without building one by
 * hand first. Each preset is just a sequence of makeTile/placeTile calls,
 * the same primitives the editor itself uses.
 */

import { cellElevation, emptyGrid, GridModel, Rotation } from '../grid/types';
import { makeTile, placeTile, tileAt, updateTile, DEFAULT_TILE_DEFAULTS, TileDefaults } from '../grid/ops';
import { Direction, Tile, TileKind } from '../grid/types';
import { rotationFor } from '../grid/ports';

const V = (rot: Rotation = 0, defaults: TileDefaults = DEFAULT_TILE_DEFAULTS) => ({ rot, defaults });

function build(cols: number, rows: number, cellSize: number, placements: Array<[TileKind, number, number, ReturnType<typeof V>?]>): GridModel {
  let grid = emptyGrid(cols, rows, cellSize);
  for (const [kind, col, row, opts] of placements) {
    const { rot, defaults } = opts ?? V();
    grid = placeTile(grid, makeTile(kind, { col, row }, rot, grid, defaults));
  }
  return grid;
}

/** Raise a source tile's head above its own elevation — an explicit,
 * visible "elevated feed tank" setup, since a plain IN no longer gets a
 * free head boost by default. */
function raiseSource(grid: GridModel, cell: { col: number; row: number }, aboveGrade: number): GridModel {
  const source = tileAt(grid, cell)!;
  return updateTile(grid, source.id, { head: cellElevation(grid, cell) + aboveGrade });
}

const seriesLine = () => {
  const grid = build(8, 5, 2, [
    ['source', 0, 2],
    ['straight', 1, 2],
    ['straight', 2, 2],
    ['straight', 3, 2],
    ['valve', 4, 2],
    ['straight', 5, 2],
    ['straight', 6, 2],
    ['sink', 7, 2],
  ]);
  // Same elevation start to finish, so without an explicit driving head
  // (and with no pump on this line) nothing would flow.
  return raiseSource(grid, { col: 0, row: 2 }, 6);
};

const branching = () => {
  const grid = build(5, 5, 2, [
    ['source', 0, 2],
    ['straight', 1, 2],
    ['tee', 2, 2], // rotation 0 -> ports W,E,S
    ['straight', 3, 2],
    ['sink', 4, 2],
    ['straight', 2, 3, V(90)], // vertical run down from the tee's S port
    ['sink', 2, 4, V(90)], // rotation 90 -> port N, receives from above
  ]);
  // The level branch (sink at row 2) has no natural elevation drop, so it
  // needs its own share of driving head too, on top of the down branch's
  // natural gravity feed — otherwise only the down branch would show flow.
  return raiseSource(grid, { col: 0, row: 2 }, 6);
};

/** Raise a sink tile's head above its own elevation — a delivery tank the
 *  pump has to lift into, which is what puts its duty point on the curve. */
function raiseSink(grid: GridModel, cell: { col: number; row: number }, aboveGrade: number): GridModel {
  const sink = tileAt(grid, cell)!;
  return updateTile(grid, sink.id, { head: cellElevation(grid, cell) + aboveGrade });
}

/**
 * Delivery tank head above grade [m]. This is what sets the system curve, and
 * it is picked to land the 50 m pump's duty point on its best-efficiency
 * flow — with no lift at all the pump runs far past runout into cavitation,
 * a real failure mode but a poor default for a starter layout.
 */
const DELIVERY_HEAD = 44;

/**
 * Source and delivery tank both need the pump: the source has no head of its
 * own, so turning the pump's speed to 0 in the Inspector stops the flow.
 */
const pumpBoost = () => {
  const grid = build(9, 5, 2, [
    ['source', 0, 2],
    ['straight', 1, 2],
    ['pump', 2, 2],
    ['straight', 3, 2],
    ['straight', 4, 2],
    ['valve', 5, 2],
    ['straight', 6, 2],
    ['straight', 7, 2],
    ['sink', 8, 2],
  ]);
  return raiseSink(grid, { col: 8, row: 2 }, DELIVERY_HEAD);
};

/**
 * Suction lift: the sump sits well below the pump, so the pump has to pull
 * the liquid up before it can push it anywhere. Nothing about the motor
 * changes — only how much of the atmosphere's 10.3 m is left after the lift —
 * so the pump ends up cavitating: it still moves water, but not at full head.
 * Lowering the IN tile's head in the Inspector deepens the lift and starves
 * it further, until it stops delivering entirely.
 */
const suctionLift = () => {
  const grid = build(8, 7, 1.5, [
    ['source', 0, 6],
    ['straight', 1, 6],
    ['elbow', 2, 6, V(270)], // ports W, N — turn the suction line upward
    ['straight', 2, 5, V(90)],
    ['straight', 2, 4, V(90)],
    ['elbow', 2, 3, V(90)], // ports E, S — arrive at pump level
    ['pump', 3, 3],
    ['straight', 4, 3],
    ['straight', 5, 3],
    ['sink', 6, 3],
  ]);
  return raiseSink(grid, { col: 6, row: 3 }, 24);
};

/**
 * Churn / deadhead: the discharge valve is shut, so the pump runs at zero
 * flow. It still absorbs shaft power, and with nothing leaving the casing all
 * of it heats the trapped liquid — open the valve in the Inspector and watch
 * the pump's stress ring go from red to green.
 */
const deadhead = () => {
  const grid = build(8, 5, 2, [
    ['source', 0, 2],
    ['straight', 1, 2],
    ['pump', 2, 2],
    ['straight', 3, 2],
    ['valve', 4, 2],
    ['straight', 5, 2],
    ['straight', 6, 2],
    ['sink', 7, 2],
  ]);
  const valve = tileAt(grid, { col: 4, row: 2 })!;
  return updateTile(raiseSink(grid, { col: 7, row: 2 }, DELIVERY_HEAD), valve.id, { opening: 0 });
};

/** FCV-101 opening in the reference loop: lands P-101A near its BEP. */
export const COOLING_LOOP_FCV_OPENING = 0.5;

/**
 * V2 reference: the open cooling-water loop (PLAN-V2 §0). Basin TK-101 →
 * strainer S-101 → duty/standby pumps P-101A/B (B stopped) → exchanger
 * E-101 → control valve FCV-101, with hand-valve bypass HV-102 (shut) →
 * riser → spray header CT-101, which falls back into TK-101. All 6".
 *
 *   row 0  (z 10.5)                                   ┌─ CT-101
 *   row 1–5 riser                                     │
 *   row 4                          ┌ HV-102 ┐         │
 *   row 6  TK─ ─S─T─P-101A─ ─T─E-101─T─FCV-101─T──────┘
 *   row 7           └ P-101B ┘
 */
const openCoolingLoop = (): GridModel => {
  let g = emptyGrid(13, 8, 1.5);
  const d: TileDefaults = { nps: '6"', schedule: '40', valveType: 'globe' };
  const put = (kind: TileKind, col: number, row: number, ports: Direction[]) => {
    g = placeTile(g, makeTile(kind, { col, row }, rotationFor(kind, ports), g, d));
  };
  put('basin', 0, 6, ['E']);
  put('straight', 1, 6, ['E', 'W']);
  put('strainer', 2, 6, ['E', 'W']);
  put('tee', 3, 6, ['W', 'E', 'S']);
  put('pump', 4, 6, ['W', 'E']); // P-101A, duty
  put('straight', 5, 6, ['E', 'W']);
  put('tee', 6, 6, ['W', 'E', 'S']);
  put('elbow', 3, 7, ['N', 'E']);
  put('pump', 4, 7, ['W', 'E']); // P-101B, standby (placed stopped)
  put('straight', 5, 7, ['E', 'W']);
  put('elbow', 6, 7, ['W', 'N']);
  put('hx', 7, 6, ['E', 'W']);
  put('tee', 8, 6, ['W', 'E', 'N']);
  put('valve', 9, 6, ['E', 'W']); // FCV-101 (control)
  put('tee', 10, 6, ['W', 'N', 'E']);
  // Bypass two rows up, so HV-102's label clears FCV-101's actuator on the PFD.
  put('straight', 8, 5, ['N', 'S']);
  put('elbow', 8, 4, ['S', 'E']);
  put('valve', 9, 4, ['E', 'W']); // HV-102 bypass (manual, shut)
  put('elbow', 10, 4, ['W', 'S']);
  put('straight', 10, 5, ['N', 'S']);
  put('elbow', 11, 6, ['W', 'N']);
  for (let row = 5; row >= 1; row--) put('straight', 11, row, ['N', 'S']);
  put('elbow', 11, 0, ['S', 'E']);
  put('spray', 12, 0, ['W']);

  const at = (col: number, row: number) => tileAt(g, { col, row })!.id;
  const set = (col: number, row: number, patch: Partial<Tile>) => {
    g = updateTile(g, at(col, row), patch);
  };
  set(0, 6, { area: 30, level: 1.5 });
  set(7, 6, { designFlow: 100 / 3600, designDp: 70_000 });
  set(9, 6, { service: 'control', tag: 'FCV-101', opening: COOLING_LOOP_FCV_OPENING });
  set(9, 4, { opening: 0 });
  return {
    ...g,
    instruments: [
      { tag: 'FI-101', type: 'FI', targetId: at(11, 3) },
      { tag: 'PI-101', type: 'PI', targetId: at(6, 6) },
      { tag: 'LI-101', type: 'LI', targetId: at(0, 6) },
    ],
  };
};

export interface GridPreset {
  name: string;
  description: string;
  build: () => GridModel;
}

export const GRID_PRESETS: GridPreset[] = [
  { name: '개방형 냉각수 루프', description: 'V2 기준 예제: 수조 → 펌프 A/B → 열교환기 → 제어밸브/바이패스 → 냉각탑', build: openCoolingLoop },
  { name: '직렬 배관', description: '소스 – 직관 – 밸브 – 싱크', build: seriesLine },
  { name: '분기 네트워크', description: '하나의 T자관에서 두 갈래로 분기', build: branching },
  { name: '펌프 승압', description: '펌프로 44 m 높이의 탱크까지 송수 (BEP 운전)', build: pumpBoost },
  { name: '흡입 양정', description: '펌프보다 낮은 수조에서 빨아올리기 — NPSH 한계로 양정 저하', build: suctionLift },
  { name: '공회전 (체절)', description: '토출 밸브를 잠근 채 운전 — 펌프에 걸리는 무리', build: deadhead },
];
