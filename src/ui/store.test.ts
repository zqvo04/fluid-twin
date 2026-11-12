import { describe, it, expect } from 'vitest';
import { useAppStore } from './store';
import { coolingLoop } from '../grid/testLoop';

describe('view mode tabs', () => {
  it('switching PFD ↔ map keeps the same element selected at the same view', () => {
    const { grid, ids } = coolingLoop();
    const s = useAppStore.getState();
    s.loadGrid(grid);
    useAppStore.getState().selectTile(ids.pump);
    useAppStore.getState().setView({ ...useAppStore.getState().view, panX: 37, panY: -12, zoom: 1.4 });
    const before = useAppStore.getState();

    useAppStore.getState().setViewMode('pfd');
    let after = useAppStore.getState();
    expect(after.viewMode).toBe('pfd');
    expect(after.selectedTileId).toBe(ids.pump);
    expect(after.view).toEqual(before.view);
    expect(after.grid).toBe(before.grid);

    useAppStore.getState().setViewMode('map');
    after = useAppStore.getState();
    expect(after.viewMode).toBe('map');
    expect(after.selectedTileId).toBe(ids.pump);
    expect(after.view).toEqual(before.view);
  });
});
