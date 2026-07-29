/**
 * Screen <-> grid coordinate transform: device-pixel-ratio-aware pan/zoom.
 * `pxPerCell` is the on-screen size of one grid cell at zoom = 1.
 */

import { Cell } from '../grid/types';

export const BASE_PX_PER_CELL = 56;

export interface Viewport {
  /** Canvas CSS width/height [px]. */
  width: number;
  height: number;
  /** Pan offset [px] of the grid origin (col=0,row=0 corner) from the canvas top-left. */
  panX: number;
  panY: number;
  zoom: number;
}

/** Fixed UI chrome that floats over the canvas (palette left, inspector right,
 * topbar). Centering accounts for it so cols/rows near the edges don't start
 * out hidden underneath a panel. */
export const CHROME_INSET = { left: 272, right: 272, top: 88, bottom: 16 };

export function defaultViewport(width: number, height: number, cols: number, rows: number): Viewport {
  const gridW = cols * BASE_PX_PER_CELL;
  const gridH = rows * BASE_PX_PER_CELL;
  const availW = Math.max(0, width - CHROME_INSET.left - CHROME_INSET.right);
  const availH = Math.max(0, height - CHROME_INSET.top - CHROME_INSET.bottom);
  return {
    width,
    height,
    panX: CHROME_INSET.left + (availW - gridW) / 2,
    panY: CHROME_INSET.top + (availH - gridH) / 2,
    zoom: 1,
  };
}

export function cellSizePx(view: Viewport): number {
  return BASE_PX_PER_CELL * view.zoom;
}

export function cellToScreen(view: Viewport, cell: Cell): { x: number; y: number } {
  const s = cellSizePx(view);
  return { x: view.panX + cell.col * s, y: view.panY + cell.row * s };
}

export function screenToCell(view: Viewport, x: number, y: number): Cell {
  const s = cellSizePx(view);
  return {
    col: Math.floor((x - view.panX) / s),
    row: Math.floor((y - view.panY) / s),
  };
}

/** Zoom while keeping the point under (anchorX, anchorY) fixed on screen. */
export function zoomAt(view: Viewport, anchorX: number, anchorY: number, factor: number): Viewport {
  const nextZoom = Math.min(3, Math.max(0.35, view.zoom * factor));
  const actualFactor = nextZoom / view.zoom;
  return {
    ...view,
    zoom: nextZoom,
    panX: anchorX - (anchorX - view.panX) * actualFactor,
    panY: anchorY - (anchorY - view.panY) * actualFactor,
  };
}

export function panBy(view: Viewport, dx: number, dy: number): Viewport {
  return { ...view, panX: view.panX + dx, panY: view.panY + dy };
}

/** Re-pan so cell (col,row) sits at the center of the canvas viewport (not
 * the chrome-adjusted board center — the user asked to see this cell now). */
export function centerOn(view: Viewport, cell: Cell): Viewport {
  const s = cellSizePx(view);
  return {
    ...view,
    panX: view.width / 2 - (cell.col + 0.5) * s,
    panY: view.height / 2 - (cell.row + 0.5) * s,
  };
}
