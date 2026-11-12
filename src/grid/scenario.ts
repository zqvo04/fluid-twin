/**
 * Grid → scenario runner adapter: basins with their spray returns, pump
 * nominal speeds, and events re-addressed from tile ids to link ids.
 */

import { CompileResult } from './compile';
import { GridModel, ScenarioEvent, cellElevation } from './types';
import { ScenarioModel } from '../physics/scenario';

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
