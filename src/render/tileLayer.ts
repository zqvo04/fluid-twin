/**
 * Draws the grid background, every placed tile, and the hover/selection
 * overlays onto a 2D context. Called on demand (state changes), not from a
 * continuous rAF loop — an editor with a few dozen tiles has no need for a
 * per-frame redraw until Phase 4's fluid layer animates on top of it.
 */

import { GridModel, Tile, sameCell } from '../grid/types';
import { Cell } from '../grid/types';
import { cellSizePx, cellToScreen, Viewport } from './viewport';
import { drawTile } from './sprites';
import { CANVAS_BG, GRID_LINE, GRID_LINE_STRONG, HOVER_FILL, SELECT_RING } from './theme';

export interface DrawOptions {
  hoverCell?: Cell | null;
  selectedTileId?: string | null;
  /** Tile ids excluded from the last compile (dangling/isolated) — dimmed. */
  excludedTileIds?: Set<string>;
  ghostTile?: Tile | null;
}

export function drawGrid(ctx: CanvasRenderingContext2D, view: Viewport, grid: GridModel, opts: DrawOptions = {}): void {
  ctx.save();
  ctx.fillStyle = CANVAS_BG;
  ctx.fillRect(0, 0, view.width, view.height);

  const s = cellSizePx(view);
  const originX = view.panX;
  const originY = view.panY;
  const gridPxW = grid.cols * s;
  const gridPxH = grid.rows * s;

  // Grid lines, only across the placed board (not the whole canvas).
  ctx.strokeStyle = GRID_LINE;
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
  ctx.strokeStyle = GRID_LINE_STRONG;
  ctx.lineWidth = 2;
  ctx.strokeRect(originX, originY, gridPxW, gridPxH);

  for (const tile of grid.tiles) {
    const { x, y } = cellToScreen(view, tile.cell);
    const excluded = opts.excludedTileIds?.has(tile.id) ?? false;
    drawTile(ctx, tile, { x, y, size: s }, excluded);

    if (opts.selectedTileId === tile.id) {
      ctx.save();
      ctx.strokeStyle = SELECT_RING;
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(x + 2, y + 2, s - 4, s - 4);
      ctx.restore();
    }
  }

  if (opts.hoverCell && opts.hoverCell.col >= 0 && opts.hoverCell.row >= 0 && opts.hoverCell.col < grid.cols && opts.hoverCell.row < grid.rows) {
    const { x, y } = cellToScreen(view, opts.hoverCell);
    ctx.fillStyle = HOVER_FILL;
    ctx.fillRect(x, y, s, s);
  }

  if (opts.ghostTile && sameCell(opts.ghostTile.cell, opts.hoverCell ?? { col: -1, row: -1 })) {
    const { x, y } = cellToScreen(view, opts.ghostTile.cell);
    ctx.save();
    ctx.globalAlpha = 0.55;
    drawTile(ctx, opts.ghostTile, { x, y, size: s });
    ctx.restore();
  }

  ctx.restore();
}
