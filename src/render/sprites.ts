/**
 * Tile drawing — one function per grid cell, driven entirely by the tile's
 * rotated ports (not by rotation angle directly), so the same code draws a
 * tee/cross/valve/etc. correctly regardless of which BASE_PORTS convention
 * ports.ts uses.
 */

import { Direction, Tile } from '../grid/types';
import { pumpPorts, tilePorts } from '../grid/ports';
import { hasCheckValve } from '../domain/network';
import { PumpState } from '../analysis/pumpHealth';
import {
  CAVITATION_WARNING,
  EXCLUDED_FILL,
  EXCLUDED_OUTLINE,
  LABEL_INK,
  PIPE_FILL,
  PIPE_HIGHLIGHT,
  PIPE_OUTLINE,
  PUMP_FILL,
  PUMP_OUTLINE,
  pumpStressColor,
  SINK_FILL,
  SINK_OUTLINE,
  SOURCE_FILL,
  SOURCE_OUTLINE,
  VALVE_FILL,
  VALVE_OUTLINE,
  pressureColor,
  pressureOutlineColor,
} from './theme';

/**
 * Drawn pipe width as a fraction of a cell. Shared with the fluid layer so
 * flow streaks stay inside the pipe they belong to.
 */
export const PIPE_WIDTH_CELLS = 0.32;

export interface TileRect {
  x: number;
  y: number;
  size: number;
}

const DIR_VECTOR: Record<Direction, [number, number]> = {
  N: [0, -1],
  S: [0, 1],
  E: [1, 0],
  W: [-1, 0],
};

function edgePoint(cx: number, cy: number, half: number, d: Direction): [number, number] {
  const [dx, dy] = DIR_VECTOR[d];
  return [cx + dx * half, cy + dy * half];
}

export interface PressureTint {
  /** Normalized 0..1 against the current field range. */
  t: number;
  /** Raw gauge pressure [Pa] — negative draws a cavitation warning mark. */
  pa: number;
  /** Per-port override of `t` (a valve's upstream/downstream sides render
   * as distinct colors instead of one averaged tone). */
  perPort?: Partial<Record<Direction, number>>;
}

/** What the last solve says a pump is going through, for its stress ring. */
export interface PumpTint {
  state: PumpState;
  /** 0 (healthy) .. 1 (being destroyed). */
  stress: number;
}

/**
 * Draw a tile complete (body then ornament). Callers rendering a whole board
 * should use `drawTileBody` and `drawTileOrnament` in two passes instead —
 * pipe stubs have round caps that bleed past the cell edge, so a neighbor
 * drawn later would otherwise paint over an ornament near the boundary.
 */
export function drawTile(
  ctx: CanvasRenderingContext2D,
  tile: Tile,
  rect: TileRect,
  excluded = false,
  pressure?: PressureTint | null,
  pump?: PumpTint | null,
): void {
  drawTileBody(ctx, tile, rect, excluded, pressure);
  drawTileOrnament(ctx, tile, rect, excluded, pressure, pump);
}

/** The pipe body only: stubs, elbow bend, hub disc. */
export function drawTileBody(
  ctx: CanvasRenderingContext2D,
  tile: Tile,
  rect: TileRect,
  excluded = false,
  pressure?: PressureTint | null,
): void {
  const { x, y, size } = rect;
  const cx = x + size / 2;
  const cy = y + size / 2;
  const half = size / 2;
  const pipeW = size * PIPE_WIDTH_CELLS;
  const ports = tilePorts(tile);

  const fill = excluded ? EXCLUDED_FILL : pressure ? pressureColor(pressure.t) : PIPE_FILL;
  const outline = excluded ? EXCLUDED_OUTLINE : pressure ? pressureOutlineColor(pressure.t) : PIPE_OUTLINE;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // --- Pipe body: stubs from center to each port, or a curved bend for a
  // two-port tile whose ports are perpendicular (an elbow). ---------------
  const stubFill = (d: Direction) => {
    const t = pressure?.perPort?.[d];
    return t === undefined ? fill : pressureColor(t);
  };
  const stubOutline = (d: Direction) => {
    const t = pressure?.perPort?.[d];
    return t === undefined ? outline : pressureOutlineColor(t);
  };
  const drawStub = (d: Direction) => {
    const [ex, ey] = edgePoint(cx, cy, half, d);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(ex, ey);
    ctx.lineWidth = pipeW + 4;
    ctx.strokeStyle = stubOutline(d);
    ctx.stroke();
    ctx.lineWidth = pipeW;
    ctx.strokeStyle = stubFill(d);
    ctx.stroke();
  };

  const isElbowShape = ports.length === 2 && !isOpposite(ports[0], ports[1]);
  if (isElbowShape) {
    const [ax, ay] = edgePoint(cx, cy, half, ports[0]);
    const [bx, by] = edgePoint(cx, cy, half, ports[1]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(cx, cy, bx, by);
    ctx.lineWidth = pipeW + 4;
    ctx.strokeStyle = outline;
    ctx.stroke();
    ctx.lineWidth = pipeW;
    ctx.strokeStyle = fill;
    ctx.stroke();
    // Soft highlight stripe for a rounded/glossy feel (skipped under a
    // pressure tint — a fixed pink gloss would fight the data color).
    if (!pressure) {
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(cx, cy, bx, by);
      ctx.lineWidth = pipeW * 0.35;
      ctx.strokeStyle = PIPE_HIGHLIGHT;
      ctx.globalAlpha = excluded ? 0 : 0.6;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  } else {
    for (const d of ports) drawStub(d);
    if (ports.length >= 3) {
      // Round hub disc so stub joints look like a single molded piece.
      ctx.beginPath();
      ctx.arc(cx, cy, pipeW / 2 + 2, 0, Math.PI * 2);
      ctx.fillStyle = outline;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, pipeW / 2, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
    }
  }

  ctx.restore();
}

/**
 * The kind-specific ornament (valve body, pump, IN/OUT cap) and the
 * cavitation mark. Drawn in a second pass so nothing overlaps it.
 */
export function drawTileOrnament(
  ctx: CanvasRenderingContext2D,
  tile: Tile,
  rect: TileRect,
  excluded = false,
  pressure?: PressureTint | null,
  pump?: PumpTint | null,
): void {
  const { x, y, size } = rect;
  const cx = x + size / 2;
  const cy = y + size / 2;
  const ports = tilePorts(tile);

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (tile.kind) {
    case 'valve':
      drawDisc(ctx, cx, cy, size * 0.24, excluded ? EXCLUDED_FILL : VALVE_FILL, excluded ? EXCLUDED_OUTLINE : VALVE_OUTLINE);
      drawValveHandle(ctx, cx, cy, size, ports, excluded ? EXCLUDED_OUTLINE : VALVE_OUTLINE);
      if (!excluded) drawOpeningArc(ctx, cx, cy, size * 0.24, tile.kind === 'valve' ? tile.opening : 1);
      break;
    case 'pump': {
      const { suction, discharge } = pumpPorts(tile);
      // The suction side is drawn before the body so the body sits on top:
      // a pump reads as "pulls from here, pushes to there", which is the one
      // thing a symmetric two-port sprite cannot say.
      if (!excluded) drawSuctionMark(ctx, cx, cy, size, suction);
      drawDisc(ctx, cx, cy, size * 0.26, excluded ? EXCLUDED_FILL : PUMP_FILL, excluded ? EXCLUDED_OUTLINE : PUMP_OUTLINE);
      drawImpeller(ctx, cx, cy, size * 0.15, excluded ? EXCLUDED_OUTLINE : PUMP_OUTLINE);
      if (!excluded) {
        // A filled arrow means the discharge check valve is fitted (one-way);
        // a hollow one means flow can be pushed back through the pump.
        drawFlowArrow(ctx, cx, cy, size, discharge, PUMP_OUTLINE, hasCheckValve(tile));
        if (pump) drawStressRing(ctx, cx, cy, size * 0.26 + 5, pump);
      }
      break;
    }
    case 'source':
      drawCap(ctx, cx, cy, size, ports[0], excluded ? EXCLUDED_FILL : SOURCE_FILL, excluded ? EXCLUDED_OUTLINE : SOURCE_OUTLINE, 'IN');
      break;
    case 'sink':
      drawCap(ctx, cx, cy, size, ports[0], excluded ? EXCLUDED_FILL : SINK_FILL, excluded ? EXCLUDED_OUTLINE : SINK_OUTLINE, 'OUT');
      break;
    default:
      break;
  }

  if (pressure && !excluded && pressure.pa < 0) {
    ctx.beginPath();
    ctx.arc(x + size * 0.16, y + size * 0.16, size * 0.09, 0, Math.PI * 2);
    ctx.fillStyle = CAVITATION_WARNING;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }

  ctx.restore();
}

function isOpposite(a: Direction, b: Direction): boolean {
  return (a === 'N' && b === 'S') || (a === 'S' && b === 'N') || (a === 'E' && b === 'W') || (a === 'W' && b === 'E');
}

function drawDisc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string, outline: string) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = outline;
  ctx.stroke();
}

function drawValveHandle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  ports: Direction[],
  color: string,
) {
  // A short perpendicular bar through the body, like a valve wheel/lever seen edge-on.
  const flowDir = ports[0] ?? 'E';
  const perp: [number, number] = flowDir === 'N' || flowDir === 'S' ? [1, 0] : [0, 1];
  const len = size * 0.22;
  ctx.beginPath();
  ctx.moveTo(cx - perp[0] * len, cy - perp[1] * len);
  ctx.lineTo(cx + perp[0] * len, cy + perp[1] * len);
  ctx.lineWidth = size * 0.06;
  ctx.strokeStyle = color;
  ctx.stroke();
}

/** A thin ring showing fractional opening (full ring = fully open). */
function drawOpeningArc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, opening: number) {
  ctx.beginPath();
  ctx.arc(cx, cy, r + 6, -Math.PI / 2, -Math.PI / 2 + opening * Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = LABEL_INK;
  ctx.globalAlpha = 0.55;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/**
 * Converging funnel on the suction stub — the visual counterpart of the
 * low-pressure region the impeller eye creates and draws liquid into.
 */
function drawSuctionMark(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, suction: Direction) {
  const [dx, dy] = DIR_VECTOR[suction];
  const [px, py] = [-dy, dx]; // perpendicular
  const outer = size * 0.48;
  const inner = size * 0.3;
  const mouth = size * 0.17;
  const throat = size * 0.06;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx + dx * outer + px * mouth, cy + dy * outer + py * mouth);
  ctx.lineTo(cx + dx * inner + px * throat, cy + dy * inner + py * throat);
  ctx.lineTo(cx + dx * inner - px * throat, cy + dy * inner - py * throat);
  ctx.lineTo(cx + dx * outer - px * mouth, cy + dy * outer - py * mouth);
  ctx.closePath();
  ctx.fillStyle = PUMP_FILL;
  ctx.globalAlpha = 0.5;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2;
  ctx.strokeStyle = PUMP_OUTLINE;
  ctx.stroke();
  ctx.restore();
}

/**
 * Chevron on the discharge stub: which way this pump actually moves fluid.
 * Filled when a check valve makes that the only possible direction, hollow
 * when the machine can be back-driven.
 */
function drawFlowArrow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  discharge: Direction,
  color: string,
  oneWay: boolean,
) {
  const [dx, dy] = DIR_VECTOR[discharge];
  const [px, py] = [-dy, dx];
  const tip = size * 0.48;
  const back = size * 0.33;
  const halfW = size * 0.11;
  ctx.beginPath();
  ctx.moveTo(cx + dx * tip, cy + dy * tip);
  ctx.lineTo(cx + dx * back + px * halfW, cy + dy * back + py * halfW);
  ctx.lineTo(cx + dx * back - px * halfW, cy + dy * back - py * halfW);
  ctx.closePath();
  if (oneWay) {
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = color;
  ctx.stroke();
}

/**
 * Ring around the pump body showing how hard a time it is having: a full red
 * circle is a pump being destroyed (churning, dry, cavitating), a short green
 * arc is one running near its BEP. A stopped pump gets a dashed grey ring.
 */
function drawStressRing(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, pump: PumpTint) {
  ctx.save();
  ctx.lineWidth = 3.5;
  if (pump.state === 'stopped') {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = EXCLUDED_OUTLINE;
    ctx.stroke();
    ctx.restore();
    return;
  }
  // Background track, then the stress arc drawn clockwise from 12 o'clock.
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
  ctx.stroke();
  const sweep = Math.max(pump.stress, 0.06) * Math.PI * 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + sweep);
  ctx.strokeStyle = pumpStressColor(pump.stress);
  ctx.stroke();
  ctx.restore();
}

function drawImpeller(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r, cx + Math.cos(a + 1) * r * 0.6, cy + Math.sin(a + 1) * r * 0.6);
    ctx.stroke();
  }
}

function drawCap(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  port: Direction,
  fill: string,
  outline: string,
  label: string,
) {
  const [dx, dy] = DIR_VECTOR[port];
  // The cap sits on the side opposite the outlet/inlet port.
  const capCx = cx - dx * size * 0.28;
  const capCy = cy - dy * size * 0.28;
  const w = size * 0.5;
  const h = size * 0.34;
  ctx.save();
  ctx.translate(capCx, capCy);
  ctx.rotate(Math.atan2(dy, dx));
  roundRectPath(ctx, -w / 2, -h / 2, w, h, h * 0.4);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = outline;
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${Math.round(size * 0.16)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, capCx, capCy);
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
