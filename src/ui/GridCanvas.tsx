import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAppStore } from './store';
import { drawGrid } from '../render/tileLayer';
import { screenToCell, zoomAt, panBy } from '../render/viewport';
import { makeTile, DEFAULT_TILE_DEFAULTS } from '../grid/ops';
import { computePressureField } from '../render/pressureField';
import { useParticleAnimation } from './useParticleAnimation';

export function GridCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fluidCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const panState = useRef<{ x: number; y: number } | null>(null);

  useParticleAnimation(fluidCanvasRef);

  const grid = useAppStore((s) => s.grid);
  const view = useAppStore((s) => s.view);
  const hoverCell = useAppStore((s) => s.hoverCell);
  const selectedTileId = useAppStore((s) => s.selectedTileId);
  const excludedTileIds = useAppStore((s) => s.excludedTileIds);
  const armedKind = useAppStore((s) => s.armedKind);
  const armedRotation = useAppStore((s) => s.armedRotation);
  const mode = useAppStore((s) => s.mode);
  const tileDefaults = useAppStore((s) => s.tileDefaults);
  const compiled = useAppStore((s) => s.compiled);
  const result = useAppStore((s) => s.result);
  const showPressure = useAppStore((s) => s.showPressure);
  const transientHeads = useAppStore((s) => s.transient.heads);
  const transientActive = useAppStore((s) => s.transient.running || s.transient.history.length > 0);
  const themeTick = useAppStore((s) => s.themeTick);

  const setHoverCell = useAppStore((s) => s.setHoverCell);
  const clickCell = useAppStore((s) => s.clickCell);
  const setView = useAppStore((s) => s.setView);
  const resetView = useAppStore((s) => s.resetView);

  // Keep both canvas backing stores sized to the container * devicePixelRatio.
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const fluidCanvas = fluidCanvasRef.current;
    if (!container || !canvas || !fluidCanvas) return;

    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      const dpr = window.devicePixelRatio || 1;
      for (const c of [canvas, fluidCanvas]) {
        c.width = Math.round(width * dpr);
        c.height = Math.round(height * dpr);
        c.style.width = `${width}px`;
        c.style.height = `${height}px`;
      }
      setView({ ...useAppStore.getState().view, width, height });
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Center the board once we know the real container size.
  const centered = useRef(false);
  useEffect(() => {
    if (centered.current && view.width > 0) return;
    if (view.width > 0) {
      resetView(view.width, view.height);
      centered.current = true;
    }
  }, [view.width, view.height]);

  const ghostTile =
    mode === 'place' ? makeTile(armedKind, hoverCell ?? { col: -1, row: -1 }, armedRotation, grid, tileDefaults ?? DEFAULT_TILE_DEFAULTS) : null;

  // During a transient run, the streamed node heads drive the pressure
  // overlay instead of the steady result — the same colormap shows the
  // surge propagate live.
  const pressureField = useMemo(() => {
    if (!showPressure) return null;
    // The transient stream only carries node heads, not per-link
    // flow/velocity, so its overlay falls back to the plain HGL-pressure
    // behavior (no static/wall-load correction) during a running surge.
    if (transientActive && transientHeads) return computePressureField(grid, compiled, transientHeads);
    return result ? computePressureField(grid, compiled, result.heads, result.links) : null;
  }, [showPressure, result, grid, compiled, transientActive, transientHeads]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawGrid(ctx, view, grid, {
      hoverCell,
      selectedTileId,
      excludedTileIds,
      ghostTile,
      compiled,
      pressureField,
      pumpHealth: result?.pumps ?? null,
    });
    // ghostTile is derived fresh each render from hoverCell/armedKind/etc, so
    // it is intentionally excluded from the dep list to avoid an identity churn.
  }, [grid, view, hoverCell, selectedTileId, excludedTileIds, armedKind, armedRotation, compiled, pressureField, result, themeTick]);

  const eventCell = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      return screenToCell(view, e.clientX - rect.left, e.clientY - rect.top);
    },
    [view],
  );

  const onMouseMove = (e: React.MouseEvent) => {
    if (panState.current) {
      const dx = e.clientX - panState.current.x;
      const dy = e.clientY - panState.current.y;
      panState.current = { x: e.clientX, y: e.clientY };
      setView(panBy(view, dx, dy));
      return;
    }
    setHoverCell(eventCell(e));
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      panState.current = { x: e.clientX, y: e.clientY };
    }
  };

  const onMouseUp = (e: React.MouseEvent) => {
    if (panState.current) {
      panState.current = null;
      return;
    }
    if (e.button === 0) {
      const cell = eventCell(e);
      if (cell) clickCell(cell);
    }
  };

  const onMouseLeave = () => {
    panState.current = null;
    setHoverCell(null);
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    setView(zoomAt(view, e.clientX - rect.left, e.clientY - rect.top, factor));
  };

  return (
    <div ref={containerRef} className="grid-viewport">
      <canvas
        ref={canvasRef}
        onMouseMove={onMouseMove}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
      <canvas ref={fluidCanvasRef} className="fluid-canvas" />
    </div>
  );
}
