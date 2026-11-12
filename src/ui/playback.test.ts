import { describe, it, expect, beforeEach } from 'vitest';
import { activeFrame, useAppStore } from './store';
import { GRID_PRESETS } from '../examples/gridPresets';
import { compile } from '../grid/compile';
import { gridAtFrame, networkEvents, scenarioModel } from '../grid/scenario';
import { GridModel } from '../grid/types';
import { runScenario, ScenarioFrame } from '../physics/scenario';
import { elementReadout } from '../readouts';
import { buildPfdList } from '../render/pfdLayer';
import { buildMapList } from '../render/mapLayer';

const preset = () => GRID_PRESETS.find((p) => p.name === '개방형 냉각수 루프')!.build();
const idOf = (g: GridModel, tag: string) => g.tiles.find((t) => 'tag' in t && t.tag === tag)!.id;

/** The reference loop's A → B switch-over, as the panel's example runs it. */
function switchOver(): { grid: GridModel; frames: ScenarioFrame[] } {
  const grid = preset();
  const compiled = compile(grid);
  const events = networkEvents(compiled, [
    { kind: 'pumpStart', t: 2, id: idOf(grid, 'P-101B'), rampS: 5 },
    { kind: 'pumpStop', t: 12, id: idOf(grid, 'P-101A') },
  ]);
  return { grid, frames: [...runScenario(scenarioModel(grid, compiled), events, { durationS: 20 })] };
}

describe('frames on screen: readouts of the grid at the frame', () => {
  const { grid, frames } = switchOver();
  const compiled = compile(grid);
  const at = (t: number) => frames.find((f) => Math.abs(f.t - t) < 1e-9)!;

  it('mid-ramp: P-101B runs at the ramp speed, and its flow is the frame flow', () => {
    const f = at(4.5); // 2.5 s into a 5 s ramp
    const g = gridAtFrame(grid, f);
    const b = elementReadout(g, compiled, f.result, idOf(g, 'P-101B'))!;
    expect(b.running).toBe(true);
    expect(b.speedPct).toBeCloseTo(50, 9);
    expect(b.flowM3h).toBeCloseTo(f.result.links.get(compiled.tileLink.get(idOf(g, 'P-101B'))!)!.flow * 3600, 9);
    // The editor's grid itself is untouched: B is still the stopped standby there.
    expect(grid.tiles.find((t) => t.id === idOf(grid, 'P-101B'))).toMatchObject({ running: false });
  });

  it('after the trip: P-101A reads its coast-down speed, falling frame by frame', () => {
    const link = compiled.tileLink.get(idOf(grid, 'P-101A'))!;
    const after = frames.filter((f) => f.t >= 12);
    for (let i = 1; i < after.length; i++) expect(after[i].speeds[link]).toBeLessThan(after[i - 1].speeds[link]);
    for (const f of after) {
      const n = f.speeds[link];
      const a = elementReadout(gridAtFrame(grid, f), compiled, f.result, idOf(grid, 'P-101A'))!;
      expect(a.speedPct).toBeCloseTo(n > 0.02 ? n * 100 : 0, 9);
      expect(a.running).toBe(n > 0.02);
    }
    expect(after[after.length - 1].speeds[link]).toBeLessThan(0.9);
  });

  it('PFD and map agree on every frame (same ids, same values as readouts)', () => {
    for (const f of frames.filter((_, i) => i % 5 === 0)) {
      const g = gridAtFrame(grid, f);
      const pfd = buildPfdList(g, compiled, f.result).items;
      const map = buildMapList(g, compiled, f.result);
      expect(pfd.map((i) => i.id).sort()).toEqual(map.map((i) => i.id).sort());
      for (const item of [...pfd, ...map]) {
        const r = elementReadout(g, compiled, f.result, item.id)!;
        for (const [k, v] of Object.entries(item.values)) expect(v, `${f.t}s ${item.id}.${k}`).toBe(r[k as keyof typeof r]);
      }
    }
  });
});

describe('playback store', () => {
  beforeEach(() => {
    useAppStore.getState().loadGrid(preset());
    useAppStore.getState().clearPlayback();
  });

  it('follows the newest frame while running, then scrubs', () => {
    const { frames } = switchOver();
    const s = useAppStore.getState();
    s.beginPlayback();
    frames.slice(0, 3).forEach((f, i) => useAppStore.getState().pushFrame(f, i === 2));
    let st = useAppStore.getState();
    expect(st.playback).toMatchObject({ index: 2, running: false });
    expect(activeFrame(st)).toBe(frames[2]);
    st.seekFrame(0);
    expect(activeFrame(useAppStore.getState())).toBe(frames[0]);
    st = useAppStore.getState();
    st.seekFrame(99);
    expect(useAppStore.getState().playback!.index).toBe(2); // clamped
  });

  it('an edit to the grid retires the frames: views go back to the steady result', () => {
    const { frames } = switchOver();
    useAppStore.getState().beginPlayback();
    useAppStore.getState().pushFrame(frames[0], true);
    expect(activeFrame(useAppStore.getState())).not.toBeNull();
    const fcv = idOf(useAppStore.getState().grid, 'FCV-101');
    useAppStore.getState().selectTile(fcv);
    useAppStore.getState().updateSelectedTile({ opening: 0.4 });
    expect(activeFrame(useAppStore.getState())).toBeNull();
  });
});
