/**
 * Draws the grid background, every placed tile, and the hover/selection
 * overlays onto a 2D context. Called on demand (state changes), not from a
 * continuous rAF loop — an editor with a few dozen tiles has no need for a
 * per-frame redraw until Phase 4's fluid layer animates on top of it.
 */

import { GridModel, Tile, sameCell } from '../grid/types';
import { Cell } from '../grid/types';
import { cellSizePx, cellToScreen, Viewport } from './viewport';
import { drawTile, drawTileBody, drawTileOrnament } from './sprites';
import { PumpHealth } from '../analysis/pumpHealth';
import { HOVER_FILL, SELECT_RING, canvasBg, gridLine, gridLineStrong } from './theme';
import { CompileResult } from '../grid/compile';
import { PressureField, tilePressure } from './pressureField';

export interface DrawOptions {
  hoverCell?: Cell | null;
  selectedTileId?: string | null;
  /** Tile ids excluded from the last compile (dangling/isolated) — dimmed. */
  excludedTileIds?: Set<string>;
  ghostTile?: Tile | null;
  /** When set (with `pressureField`), tiles are tinted by solved pressure. */
  compiled?: CompileResult | null;
  pressureField?: PressureField | null;
  /** Solved pump condition, keyed by pump link id (needs `compiled` to map
   *  a pump tile to its link). */
  pumpHealth?: Map<string, PumpHealth> | null;
}

/** The solved condition of the pump a tile owns, if there is one. */
function pumpTintFor(tileId: string, opts: DrawOptions) {
  if (!opts.compiled || !opts.pumpHealth) return null;
  const linkId = opts.compiled.tileLink.get(tileId);
  const health = linkId ? opts.pumpHealth.get(linkId) : undefined;
  return health ? { state: health.state, stress: health.stress } : null;
}

export function drawGrid(ctx: CanvasRenderingContext2D, view: Viewport, grid: GridModel, opts: DrawOptions = {}): void {
  ctx.save();
  ctx.fillStyle = canvasBg();
  ctx.fillRect(0, 0, view.width, view.height);

  const s = cellSizePx(view);
  const originX = view.panX;
  const originY = view.panY;
  const gridPxW = grid.cols * s;
  const gridPxH = grid.rows * s;

  // Grid lines, only across the placed board (not the whole canvas).
  ctx.strokeStyle = gridLine();
  ctx.lineWidth = 1;
  for (let c = 0; c <= grid.cols; c++) {
    const x = originX + c * s;
    ctx.beginPath();
    ctx.moveTo(x, originY);
    ctx.lineTo(x, originY + gridPxH);
    ctx.stroke();
  }
  for (let r = 0; r <= grid.rows; r++) {
    const y = originY + r * s;
    ctx.beginPath();
    ctx.moveTo(originX, y);
    ctx.lineTo(originX + gridPxW, y);
    ctx.stroke();
  }
  ctx.strokeStyle = gridLineStrong();
  ctx.lineWidth = 2;
  ctx.strokeRect(originX, originY, gridPxW, gridPxH);

  const showPressure = opts.compiled && opts.pressureField;

  // Two passes: every pipe body first, then every ornament. Stub round-caps
  // bleed a little past the cell edge, so a single pass would let a later
  // neighbor paint over the previous tile's ornament (a pump's flow arrow
  // sits close enough to the boundary for that to matter).
  const drawn = grid.tiles.map((tile) => {
    const { x, y } = cellToScreen(view, tile.cell);
    const rect = { x, y, size: s };
    const excluded = opts.excludedTileIds?.has(tile.id) ?? false;
    const pressure = showPressure ? tilePressure(tile.id, grid, opts.compiled!, opts.pressureField!) : null;
    drawTileBody(ctx, tile, rect, excluded, pressure);
    return { tile, rect, excluded, pressure };
  });

  for (const { tile, rect, excluded, pressure } of drawn) {
    const { x, y } = rect;
    drawTileOrnament(ctx, tile, rect, excluded, pressure, pumpTintFor(tile.id, opts));

    if (opts.selectedTileId === tile.id) {
      ctx.save();
      ctx.strokeStyle = SELECT_RING;
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(x + 2, y + 2, s - 4, s - 4);
      ctx.restore();
    }
  }

  const hoverInBounds =
    !!opts.hoverCell && opts.hoverCell.col >= 0 && opts.hoverCell.row >= 0 && opts.hoverCell.col < grid.cols && opts.hoverCell.row < grid.rows;

  if (hoverInBounds) {
    const { x, y } = cellToScreen(view, opts.hoverCell!);
    ctx.fillStyle = HOVER_FILL;
    ctx.fillRect(x, y, s, s);
  }

  if (hoverInBounds && opts.ghostTile && sameCell(opts.ghostTile.cell, opts.hoverCell!)) {
    const { x, y } = cellToScreen(view, opts.ghostTile.cell);
    ctx.save();
    ctx.globalAlpha = 0.55;
    drawTile(ctx, opts.ghostTile, { x, y, size: s });
    ctx.restore();
  }

  ctx.restore();
}
