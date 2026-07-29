import { useRef, useState } from 'react';
import { useAppStore } from './store';
import { serializeGrid, deserializeGrid } from '../grid/serialize';
import { zoomAt } from '../render/viewport';
import { WarningsPanel } from './WarningsPanel';
import { GRID_PRESETS } from '../examples/gridPresets';
import { applyTheme, getStoredTheme, nextTheme, ThemeMode } from './theme';

const THEME_LABEL: Record<ThemeMode, string> = { system: '자동', light: '라이트', dark: '다크' };

export function Toolbar() {
  const grid = useAppStore((s) => s.grid);
  const view = useAppStore((s) => s.view);
  const newGrid = useAppStore((s) => s.newGrid);
  const loadGrid = useAppStore((s) => s.loadGrid);
  const setView = useAppStore((s) => s.setView);
  const bumpTheme = useAppStore((s) => s.bumpTheme);
  const fileInput = useRef<HTMLInputElement>(null);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(getStoredTheme);

  const onToggleTheme = () => {
    const next = nextTheme(theme);
    applyTheme(next);
    setTheme(next);
    bumpTheme();
  };

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

      <WarningsPanel />

      <div className="topbar-right">
        <button onClick={() => newGrid(16, 10, 1)}>새로 만들기</button>
        <div className="preset-dropdown-wrap">
          <button onClick={() => setPresetsOpen((v) => !v)}>예제 ▾</button>
          {presetsOpen && (
            <div className="preset-dropdown">
              {GRID_PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => {
                    loadGrid(p.build());
                    setPresetsOpen(false);
                  }}
                >
                  <b>{p.name}</b>
                  <span>{p.description}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button onClick={onSave}>저장</button>
        <button onClick={() => fileInput.current?.click()}>불러오기</button>
        <input ref={fileInput} type="file" accept="application/json" hidden onChange={onLoadFile} />

        <div className="zoom-controls">
          <button onClick={() => setView(zoomAt(view, view.width / 2, view.height / 2, 1 / 1.2))}>−</button>
          <span>{Math.round(view.zoom * 100)}%</span>
          <button onClick={() => setView(zoomAt(view, view.width / 2, view.height / 2, 1.2))}>+</button>
        </div>

        <button onClick={onToggleTheme} title="테마 전환">
          {THEME_LABEL[theme]}
        </button>
      </div>
    </header>
  );
}
