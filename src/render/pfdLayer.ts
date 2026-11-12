/**
 * PFD mode: the grid drawn as a process flow diagram — ISO symbols on the
 * same cells the map uses, tags, line numbers `{NPS}-CW-1nn`, stream markers,
 * flow arrows, ISA instrument bubbles with their readings and a stream table.
 * Every number comes from readouts.ts via the render list (§1.2).
 */

import { CompileResult } from '../grid/compile';
import { Cell, Direction, GridModel, Tile, sameCell } from '../grid/types';
import { pumpPorts, tilePorts } from '../grid/ports';
import { SolvedState, StreamRow, elementReadout, ownerOfNode, streamTable } from '../readouts';
import { RenderItem, fmt, pickValues } from './renderList';
import { PfdSymbol, Ink, drawFlowArrow, drawInstrumentBubble, drawPfdSymbol, drawStreamMarker } from './pfdSymbols';
import { CHROME_INSET, Viewport, cellSizePx, cellToScreen } from './viewport';
import { HOVER_FILL, SELECT_RING, gridLine, pfdInk } from './theme';
import { easyName } from '../learn/glossary';
import { m3sToM3h } from '../domain/units';

export interface PfdItem extends RenderItem {
  symbol?: PfdSymbol;
  /** Symbol axis [rad], screen coordinates (0 = +x, π/2 = down). */
  angle?: number;
  control?: boolean;
}

export interface PfdRun {
  linkId: string;
  stream: number;
  lineNo: string;
  /** Marker position in cell units (cell centre = col + 0.5). */
  x: number;
  y: number;
  /** Flow direction [rad]; null when unsolved or no flow. */
  angle: number | null;
  /** Pipe tiles in the run; 0 = equipment joined directly (no room for a label). */
  pipeTiles: number;
  /** The run runs up/down at its marker (labels go beside the line, not across it). */
  vertical: boolean;
}

export interface PfdList {
  items: PfdItem[];
  runs: PfdRun[];
  table: Array<StreamRow & { lineNo: string }>;
}

const ANGLE: Record<Direction, number> = { E: 0, S: Math.PI / 2, W: Math.PI, N: -Math.PI / 2 };
const VALVE_SYMBOL = { gate: 'gateValve', globe: 'globeValve', ball: 'ballValve', butterfly: 'butterflyValve' } as const;

function symbolFor(tile: Tile): Pick<PfdItem, 'symbol' | 'angle' | 'control'> {
  const ports = tilePorts(tile);
  // Symmetric bodies: the line's axis folded into [0, π), so an actuator never points down.
  const axis = ports.length === 2 ? ((ANGLE[ports[0]] % Math.PI) + Math.PI) % Math.PI : 0;
  switch (tile.kind) {
    case 'pump':
      return { symbol: 'pump', angle: ANGLE[pumpPorts(tile).discharge] };
    case 'valve':
      return { symbol: VALVE_SYMBOL[tile.valveType], angle: axis, control: tile.service === 'control' };
    case 'strainer':
      return { symbol: 'strainer', angle: axis };
    case 'hx':
      return { symbol: 'hx', angle: axis };
    case 'basin':
      return { symbol: 'tank', angle: 0 };
    case 'spray':
      return { symbol: 'spray', angle: 0 };
    case 'source':
      return { symbol: 'offPage', angle: ANGLE[ports[0]] }; // points out along the outlet
    case 'sink':
      return { symbol: 'offPage', angle: ANGLE[ports[0]] + Math.PI }; // points in, away from the inlet
    default:
      return {};
  }
}

const centre = (c: Cell) => ({ x: c.col + 0.5, y: c.row + 0.5 });

export function buildPfdList(grid: GridModel, compiled: CompileResult, result: SolvedState | null): PfdList {
  const items: PfdItem[] = grid.tiles.map((tile) => ({
    id: tile.id,
    kind: tile.kind,
    cell: tile.cell,
    // Dual label, tag first on the PFD (§1.3).
    labels: 'tag' in tile ? [tile.tag, easyName(tile.kind, tile.tag)] : [],
    values: {},
    ...symbolFor(tile),
  }));
  for (const inst of grid.instruments) {
    const r = elementReadout(grid, compiled, result, inst.tag)!;
    items.push({
      id: inst.tag,
      kind: inst.type,
      cell: grid.tiles.find((t) => t.id === inst.targetId)?.cell ?? { col: -1, row: -1 },
      labels: [inst.tag],
      values: pickValues(r, ['value']),
    });
  }

  const cellOf = new Map(grid.tiles.map((t) => [t.id, t.cell]));
  const runs: PfdRun[] = [];
  for (const link of compiled.network.links) {
    const runTiles = compiled.linkRunTiles.get(link.id);
    if (!runTiles || link.kind !== 'pipe') continue;
    const stream = runs.length + 1;
    const lineNo = `${link.nps}-CW-1${String(stream).padStart(2, '0')}`;
    // Cell path from the `from` hub through the run to the `to` hub.
    const path = [
      cellOf.get(ownerOfNode(compiled, link.from)),
      ...runTiles.map((id) => cellOf.get(id)),
      cellOf.get(ownerOfNode(compiled, link.to)),
    ].map((c) => centre(c!));
    const flow = result?.links.get(link.id)?.flow ?? 0;
    const mid = Math.floor((path.length - 1) / 2);
    const [a, b] = flow < 0 ? [path[mid + 1], path[mid]] : [path[mid], path[mid + 1]];
    // Marker between the two cells around the run's middle: on a pipe tile
    // when there is one, else halfway along a direct hub-to-hub joint.
    const at = runTiles.length ? path[Math.ceil(runTiles.length / 2)] : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    runs.push({
      linkId: link.id,
      stream,
      lineNo,
      x: at.x,
      y: at.y,
      // No arrow where the table shows 0.0 m³/h: a shut valve's or a stopped
      // pump's numerical leak (~1e-6 m³/s) is not a flow direction.
      angle: result && Math.abs(m3sToM3h(flow)) >= 0.05 ? Math.atan2(b.y - a.y, b.x - a.x) : null,
      pipeTiles: runTiles.length,
      vertical: Math.abs(b.y - a.y) > Math.abs(b.x - a.x),
    });
  }
  const lineNoOf = new Map(runs.map((r) => [r.linkId, r.lineNo]));
  const table = result ? streamTable(compiled, result).map((row) => ({ ...row, lineNo: lineNoOf.get(row.linkId) ?? '' })) : [];
  return { items, runs, table };
}

export interface PfdDrawOptions {
  hoverCell?: Cell | null;
  selectedTileId?: string | null;
  ghostTile?: Tile | null;
}

function drawLines(ctx: CanvasRenderingContext2D, tile: Tile, cx: number, cy: number, s: number, ink: Ink) {
  ctx.beginPath();
  for (const d of tilePorts(tile)) {
    const v = ANGLE[d];
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + (Math.cos(v) * s) / 2, cy + (Math.sin(v) * s) / 2);
  }
  ctx.strokeStyle = ink.ink;
  ctx.lineWidth = Math.max(1.5, s * 0.035);
  ctx.lineCap = 'butt';
  ctx.stroke();
}

function drawSymbolAt(ctx: CanvasRenderingContext2D, item: PfdItem, cx: number, cy: number, s: number, ink: Ink) {
  if (!item.symbol) return;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(item.angle ?? 0);
  drawPfdSymbol(ctx, item.symbol, s, ink, { control: item.control });
  ctx.restore();
}

export function drawPfd(ctx: CanvasRenderingContext2D, view: Viewport, grid: GridModel, list: PfdList, opts: PfdDrawOptions = {}): void {
  const ink = pfdInk();
  const s = cellSizePx(view);
  const px = (x: number, y: number) => ({ x: view.panX + x * s, y: view.panY + y * s });
  ctx.save();
  ctx.fillStyle = ink.paper;
  ctx.fillRect(0, 0, view.width, view.height);

  // Faint cell grid: editing stays on the same cells as the map.
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = gridLine();
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 0; c <= grid.cols; c++) {
    ctx.moveTo(view.panX + c * s, view.panY);
    ctx.lineTo(view.panX + c * s, view.panY + grid.rows * s);
  }
  for (let r = 0; r <= grid.rows; r++) {
    ctx.moveTo(view.panX, view.panY + r * s);
    ctx.lineTo(view.panX + grid.cols * s, view.panY + r * s);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  const byId = new Map(list.items.map((i) => [i.id, i]));
  for (const tile of grid.tiles) {
    const { x, y } = px(tile.cell.col + 0.5, tile.cell.row + 0.5);
    drawLines(ctx, tile, x, y, s, ink);
  }

  const font = (k: number, w = 500) => `${w} ${Math.max(9, Math.round(s * k))}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const tile of grid.tiles) {
    const item = byId.get(tile.id)!;
    const { x, y } = px(tile.cell.col + 0.5, tile.cell.row + 0.5);
    drawSymbolAt(ctx, item, x, y, s, ink);
    if (item.labels.length) {
      ctx.fillStyle = ink.ink;
      ctx.font = font(0.16, 600);
      ctx.fillText(item.labels[0], x, y + s * 0.4);
      if (item.labels[1]) {
        ctx.font = font(0.12);
        ctx.fillText(item.labels[1], x, y + s * 0.4 + Math.max(10, s * 0.18));
      }
    }
  }

  for (const run of list.runs) {
    const { x, y } = px(run.x, run.y);
    if (run.angle !== null) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(run.angle);
      drawFlowArrow(ctx, s, ink);
      ctx.restore();
    }
    ctx.save();
    ctx.translate(x - s * 0.28, y - s * 0.3);
    drawStreamMarker(ctx, run.stream, s * 0.12, ink);
    ctx.restore();
    // Line number under the line (tags sit lower, under their symbols). A
    // direct equipment joint has no free cell for it: the table carries it.
    if (run.pipeTiles > 0) {
      ctx.fillStyle = ink.ink;
      ctx.font = font(0.11);
      if (run.vertical) {
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(run.lineNo, x + s * 0.1, y + s * 0.15);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
      } else {
        ctx.fillText(run.lineNo, x, y + s * 0.12);
      }
    }
  }

  // Instrument bubbles, stacked above their target.
  const stack = new Map<string, number>();
  for (const item of list.items) {
    if (item.kind !== 'FI' && item.kind !== 'PI' && item.kind !== 'LI' && item.kind !== 'FIC') continue;
    if (item.cell.col < 0) continue;
    const key = `${item.cell.col},${item.cell.row}`;
    const k = stack.get(key) ?? 0;
    stack.set(key, k + 1);
    const t = px(item.cell.col + 0.5, item.cell.row + 0.5);
    // Bubbles in their own band above the line, readings under them, stream
    // diamonds below that — no two label kinds share a band.
    const b = px(item.cell.col + 0.8, item.cell.row - 0.45 - k * 0.75);
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(t.x, t.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = ink.ink;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    const [letters, loop] = item.id.split('-');
    ctx.save();
    ctx.translate(b.x, b.y);
    drawInstrumentBubble(ctx, letters, loop ?? '', s * 0.22, ink, item.kind === 'FIC');
    ctx.restore();
    const v = item.values.value;
    if (v !== undefined) {
      // Reading under the bubble, so neighbouring bubbles never cover it.
      const text = fmt(v, item.kind === 'PI' ? 'bar g' : item.kind === 'LI' ? 'm' : 'm³/h');
      ctx.font = font(0.12, 600);
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = ink.paper; // the leader line passes behind the reading
      ctx.fillRect(b.x - tw / 2 - 2, b.y + s * 0.235, tw + 4, s * 0.15);
      ctx.fillStyle = ink.ink;
      ctx.fillText(text, b.x, b.y + s * 0.24);
    }
  }

  const sel = opts.selectedTileId ? grid.tiles.find((t) => t.id === opts.selectedTileId) : undefined;
  if (sel) {
    const { x, y } = cellToScreen(view, sel.cell);
    ctx.save();
    ctx.strokeStyle = SELECT_RING;
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x + 2, y + 2, s - 4, s - 4);
    ctx.restore();
  }
  const hc = opts.hoverCell;
  if (hc && hc.col >= 0 && hc.row >= 0 && hc.col < grid.cols && hc.row < grid.rows) {
    const { x, y } = cellToScreen(view, hc);
    ctx.fillStyle = HOVER_FILL;
    ctx.fillRect(x, y, s, s);
    const g = opts.ghostTile;
    if (g && sameCell(g.cell, hc)) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      drawLines(ctx, g, x + s / 2, y + s / 2, s, ink);
      drawSymbolAt(ctx, { id: g.id, kind: g.kind, cell: g.cell, labels: [], values: {}, ...symbolFor(g) }, x + s / 2, y + s / 2, s, ink);
      ctx.restore();
    }
  }

  drawStreamTable(ctx, list.table, ink);
  ctx.restore();
}

/** Stream table, pinned to the top-left of the view (screen space). */
function drawStreamTable(ctx: CanvasRenderingContext2D, rows: PfdList['table'], ink: Ink) {
  if (!rows.length) return;
  const cols = ['◇', 'Line', 'Q m³/h', 'P bar g', 'V m/s'];
  const widths = [28, 92, 70, 70, 58];
  const rowH = 18;
  // Clear of the palette panel and top bar that float over the canvas.
  const x0 = CHROME_INSET.left + 12;
  const y0 = CHROME_INSET.top;
  const w = widths.reduce((a, b) => a + b, 0);
  ctx.save();
  ctx.fillStyle = ink.paper;
  ctx.globalAlpha = 0.92;
  ctx.fillRect(x0, y0, w, rowH * (rows.length + 1) + 6);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = ink.ink;
  ctx.lineWidth = 1;
  ctx.strokeRect(x0, y0, w, rowH * (rows.length + 1) + 6);
  ctx.fillStyle = ink.ink;
  ctx.textBaseline = 'middle';
  const cellsOf = (r: (typeof rows)[number]) => [
    String(r.stream),
    r.lineNo,
    r.flowM3h.toFixed(1),
    r.pressureBarG.toFixed(3),
    r.velocityMs.toFixed(2),
  ];
  [cols, ...rows.map(cellsOf)].forEach((cells, i) => {
    let x = x0 + 6;
    ctx.font = `${i === 0 ? 700 : 500} 11px system-ui, sans-serif`;
    cells.forEach((text, j) => {
      ctx.textAlign = j < 2 ? 'left' : 'right';
      ctx.fillText(text, j < 2 ? x : x + widths[j] - 10, y0 + 3 + rowH * i + rowH / 2);
      x += widths[j];
    });
  });
  ctx.restore();
}
