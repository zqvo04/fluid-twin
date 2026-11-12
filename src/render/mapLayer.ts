/**
 * Map mode: the V1 tile board (pressure-coloured pipes, icons; particles on
 * their own canvas) plus callouts — easy name + tag and the few key values per
 * element. Values come from readouts.ts through the render list (§1.2).
 */

import { CompileResult } from '../grid/compile';
import { GridModel, Tile } from '../grid/types';
import { SolvedState, elementReadout } from '../readouts';
import { KIND_LABEL } from '../ui/kindLabels';
import { RenderItem, ValueKey, UNIT, fmt, pickValues } from './renderList';
import { DrawOptions, drawGrid } from './tileLayer';
import { Viewport, cellSizePx } from './viewport';
import { LABEL_INK } from './theme';

/** Key values a beginner sees per kind; everything else is colour and particles. */
const MAP_VALUES: Partial<Record<Tile['kind'], ValueKey[]>> = {
  pump: ['flowM3h', 'speedPct'],
  valve: ['openingPct', 'flowM3h'],
  basin: ['levelM'],
  strainer: ['dpBar'],
  hx: ['dpBar'],
  spray: ['flowM3h'],
  source: ['flowM3h'],
  sink: ['flowM3h'],
};

/**
 * Easy name. shortcut: kind label (+ A/B for a pump) until the P4-1 glossary
 * lands; swap this for the glossary lookup then.
 */
function easyName(tile: Tile): string {
  const suffix = tile.kind === 'pump' ? / ?([AB])$/.exec(tile.tag)?.[1] : undefined;
  return suffix ? `${KIND_LABEL[tile.kind]} ${suffix}` : KIND_LABEL[tile.kind];
}

export function buildMapList(grid: GridModel, compiled: CompileResult, result: SolvedState | null): RenderItem[] {
  const items: RenderItem[] = grid.tiles.map((tile) => {
    const keys = MAP_VALUES[tile.kind];
    return {
      id: tile.id,
      kind: tile.kind,
      cell: tile.cell,
      labels: 'tag' in tile ? [easyName(tile), tile.tag] : [],
      values: keys ? pickValues(elementReadout(grid, compiled, result, tile.id)!, keys) : {},
    };
  });
  for (const inst of grid.instruments) {
    items.push({
      id: inst.tag,
      kind: inst.type,
      cell: grid.tiles.find((t) => t.id === inst.targetId)?.cell ?? { col: -1, row: -1 },
      labels: [inst.tag],
      values: pickValues(elementReadout(grid, compiled, result, inst.tag)!, ['value']),
    });
  }
  return items;
}

const INSTRUMENT_UNIT = { FI: 'm³/h', FIC: 'm³/h', PI: 'bar g', LI: 'm' } as const;

function bubble(ctx: CanvasRenderingContext2D, x: number, y: number, lines: string[], fontPx: number) {
  ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + fontPx;
  const h = lines.length * fontPx * 1.3 + fontPx * 0.5;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.strokeStyle = 'rgba(32, 48, 47, 0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h, w, h, fontPx * 0.5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = LABEL_INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => {
    ctx.font = `${i === 0 ? 700 : 500} ${fontPx}px system-ui, sans-serif`;
    ctx.fillText(l, x, y - h + fontPx * 0.3 + i * fontPx * 1.3);
  });
}

const isInstrument = (k: RenderItem['kind']) => k === 'FI' || k === 'PI' || k === 'LI' || k === 'FIC';

/**
 * Board + one callout for the selected and the hovered element: "펌프 A
 * (P-101A)", its key values, and the readings of instruments on it. Only the
 * focused elements get one — on a one-cell pitch callouts for all would bury
 * the board the map exists to show.
 */
export function drawMap(ctx: CanvasRenderingContext2D, view: Viewport, grid: GridModel, list: RenderItem[], opts: DrawOptions = {}): void {
  drawGrid(ctx, view, grid, opts);
  const s = cellSizePx(view);
  const fontPx = Math.max(10, Math.round(s * 0.15));
  const hc = opts.hoverCell;
  const focus = list.filter(
    (i) =>
      !isInstrument(i.kind) &&
      (i.id === opts.selectedTileId || (hc && hc.col === i.cell.col && hc.row === i.cell.row)),
  );
  ctx.save();
  for (const item of focus) {
    const values = (Object.keys(item.values) as ValueKey[]).map((k) => fmt(item.values[k]!, UNIT[k]));
    const probes = list
      .filter((i) => isInstrument(i.kind) && i.cell.col === item.cell.col && i.cell.row === item.cell.row)
      .map((i) => {
        const v = i.values.value;
        return v === undefined ? i.labels[0] : `${i.labels[0]}  ${fmt(v, INSTRUMENT_UNIT[i.kind as keyof typeof INSTRUMENT_UNIT])}`;
      });
    const title = item.labels.length ? `${item.labels[0]} (${item.labels[1]})` : KIND_LABEL[item.kind as Tile['kind']];
    const lines = [title, ...(values.length ? [values.join(' · ')] : []), ...probes];
    bubble(ctx, view.panX + (item.cell.col + 0.5) * s, view.panY + item.cell.row * s - 4, lines, fontPx);
  }
  ctx.restore();
}
