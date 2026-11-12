/**
 * Grid → scenario runner adapter: basins with their spray returns, pump
 * nominal speeds, and events re-addressed from tile ids to link ids.
 */

import { CompileResult } from './compile';
import { GridModel, ScenarioEvent, cellElevation } from './types';
import { ScenarioFrame, ScenarioModel } from '../physics/scenario';

export function scenarioModel(grid: GridModel, compiled: CompileResult): ScenarioModel {
  return {
    network: compiled.network,
    basins: grid.tiles.flatMap((b) =>
      b.kind === 'basin'
        ? [
            {
              nodeId: b.id,
              area: b.area,
              floor: cellElevation(grid, b.cell),
              level: b.level,
              inflowNodeIds: grid.tiles.flatMap((s) => (s.kind === 'spray' && s.returnBasinId === b.id ? [`${s.id}:b`] : [])),
            },
          ]
        : [],
    ),
    nominalSpeed: Object.fromEntries(grid.tiles.flatMap((p) => (p.kind === 'pump' ? [[`L${p.id}`, p.speedRatio]] : []))),
  };
}

/** Events with tile ids → the same events on their compiled link ids. */
export function networkEvents(compiled: CompileResult, events: ScenarioEvent[]): ScenarioEvent[] {
  return events.map((e) => ({ ...e, id: compiled.tileLink.get(e.id) ?? e.id }));
}

/**
 * The grid as it stands at a scenario frame: each pump's speed (running
 * when it turns), each valve's opening and each basin's level taken from the
 * frame. Feeding this — not the editor's grid — to readouts keeps every
 * number on screen the frame's (§1.2).
 */
export function gridAtFrame(grid: GridModel, frame: ScenarioFrame): GridModel {
  return {
    ...grid,
    tiles: grid.tiles.map((t) => {
      const link = `L${t.id}`;
      if (t.kind === 'pump' && link in frame.speeds) {
        const n = frame.speeds[link];
        // Below the solver's stop threshold the pump is a blocked line, i.e. stopped.
        return n > 0.02 ? { ...t, running: true, speedRatio: n } : { ...t, running: false };
      }
      if (t.kind === 'valve' && link in frame.openings) return { ...t, opening: frame.openings[link] };
      if (t.kind === 'basin' && t.id in frame.levels) return { ...t, level: frame.levels[t.id] };
      return t;
    }),
  };
}
