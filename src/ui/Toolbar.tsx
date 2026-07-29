import { useRef } from 'react';
import { useAppStore } from './store';
import { serializeGrid, deserializeGrid } from '../grid/serialize';
import { zoomAt } from '../render/viewport';

export function Toolbar() {
  const grid = useAppStore((s) => s.grid);
  const view = useAppStore((s) => s.view);
  const issues = useAppStore((s) => s.issues);
  const newGrid = useAppStore((s) => s.newGrid);
  const loadGrid = useAppStore((s) => s.loadGrid);
  const setView = useAppStore((s) => s.setView);
  const fileInput = useRef<HTMLInputElement>(null);

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warnCount = issues.filter((i) => i.severity === 'warning').length;

  const onSave = () => {
    const blob = new Blob([serializeGrid(grid)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fluidtwin-grid.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const onLoadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      loadGrid(deserializeGrid(text));
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(err instanceof Error ? err.message : 'Failed to load project.');
    }
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="mark" aria-hidden />
        FluidTwin
        <small>2D Sandbox</small>
      </div>

      <div className="topbar-spacer" />

      {(errorCount > 0 || warnCount > 0) && (
        <div className="diag-badges">
          {errorCount > 0 && <span className="badge danger">오류 {errorCount}</span>}
          {warnCount > 0 && <span className="badge warn">경고 {warnCount}</span>}
        </div>
      )}

      <div className="topbar-right">
        <button onClick={() => newGrid(16, 10, 1)}>새로 만들기</button>
        <button onClick={onSave}>저장</button>
        <button onClick={() => fileInput.current?.click()}>불러오기</button>
        <input ref={fileInput} type="file" accept="application/json" hidden onChange={onLoadFile} />

        <div className="zoom-controls">
          <button onClick={() => setView(zoomAt(view, view.width / 2, view.height / 2, 1 / 1.2))}>−</button>
          <span>{Math.round(view.zoom * 100)}%</span>
          <button onClick={() => setView(zoomAt(view, view.width / 2, view.height / 2, 1.2))}>+</button>
        </div>
      </div>
    </header>
  );
}
