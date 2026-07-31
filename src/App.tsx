import { useEffect } from 'react';
import { GridCanvas } from './ui/GridCanvas';
import { Palette } from './ui/Palette';
import { Inspector } from './ui/Inspector';
import { Toolbar } from './ui/Toolbar';
import { Legend } from './ui/Legend';
import { TransientPanel } from './ui/TransientPanel';
import { StatusBar } from './ui/StatusBar';
import { useAppStore } from './ui/store';
import { useAutoSolve } from './ui/useAutoSolve';

export default function App() {
  useAutoSolve();

  const rotateArmed = useAppStore((s) => s.rotateArmed);
  const setMode = useAppStore((s) => s.setMode);
  const selectedTileId = useAppStore((s) => s.selectedTileId);
  const deleteSelected = useAppStore((s) => s.deleteSelected);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'r' || e.key === 'R') rotateArmed();
      if (e.key === 'Escape') setMode('select');
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedTileId) deleteSelected();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rotateArmed, setMode, selectedTileId, deleteSelected]);

  return (
    <div className="app">
      <div className="canvas-layer">
        <GridCanvas />
      </div>

      <Toolbar />
      <div className="left-dock">
        <Palette />
        <TransientPanel />
      </div>
      <Inspector />
      <Legend />
      <StatusBar />
    </div>
  );
}
