import { ReactNode, useState } from 'react';
import { GridModel, ScenarioEvent, Tile } from '../grid/types';

export type EventKind = ScenarioEvent['kind'];
export const EVENT_LABEL: Record<EventKind, string> = { pumpStart: '펌프 기동', pumpStop: '펌프 정지', valveStroke: '밸브 조작' };

/**
 * One operating event: pump start (ramp), pump stop (trip), or valve stroke
 * (target opening over a stroke time), on a tile picked by tag. Shared by the
 * scenario timeline (with an event time) and the surge check (t = 0).
 */
export function EventForm({
  grid,
  withTime,
  initialKind = 'pumpStart',
  disabled,
  submitLabel,
  onSubmit,
  hint,
}: {
  grid: GridModel;
  withTime: boolean;
  initialKind?: EventKind;
  disabled?: boolean;
  submitLabel: string;
  onSubmit: (e: ScenarioEvent) => void;
  /** Shown above the button for the event as currently filled in. */
  hint?: (e: ScenarioEvent) => ReactNode;
}) {
  const valveDefaults = { a: initialKind === 'valveStroke' ? 0 : 30, b: initialKind === 'valveStroke' ? 0.5 : 10 };
  const [d, setD] = useState<{ kind: EventKind; id: string; t: number; a: number; b: number }>({
    kind: initialKind,
    id: '',
    t: 2,
    a: initialKind === 'valveStroke' ? valveDefaults.a : 5,
    b: valveDefaults.b,
  });

  const pumps = grid.tiles.filter((t) => t.kind === 'pump');
  const valves = grid.tiles.filter((t) => t.kind === 'valve');
  const targets: Tile[] = d.kind === 'valveStroke' ? valves : pumps;
  const id = targets.some((t) => t.id === d.id) ? d.id : targets[0]?.id ?? '';
  const t = withTime ? Math.max(0, d.t) : 0;
  const event: ScenarioEvent | null = !id
    ? null
    : d.kind === 'pumpStart'
      ? { kind: 'pumpStart', t, id, rampS: Math.max(0, d.a) }
      : d.kind === 'pumpStop'
        ? { kind: 'pumpStop', t, id }
        : { kind: 'valveStroke', t, id, target: Math.min(1, Math.max(0, d.a / 100)), timeS: Math.max(0, d.b) };

  return (
    <div className="section">
      <label className="ef">
        <span>동작</span>
        <select
          value={d.kind}
          disabled={disabled}
          onChange={(e) => setD({ ...d, kind: e.target.value as EventKind, a: e.target.value === 'valveStroke' ? valveDefaults.a : 5, b: valveDefaults.b })}
        >
          {(Object.keys(EVENT_LABEL) as EventKind[]).map((k) => (
            <option key={k} value={k} disabled={k === 'valveStroke' ? !valves.length : !pumps.length}>
              {EVENT_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <label className="ef">
        <span>대상</span>
        <select value={id} disabled={disabled} onChange={(e) => setD({ ...d, id: e.target.value })}>
          {targets.map((x) => (
            <option key={x.id} value={x.id}>
              {'tag' in x ? x.tag : x.id}
            </option>
          ))}
        </select>
      </label>
      {withTime && (
        <label className="ef">
          <span>시각 [s]</span>
          <input type="number" min={0} step={0.5} value={d.t} disabled={disabled} onChange={(e) => setD({ ...d, t: Number(e.target.value) })} />
        </label>
      )}
      {d.kind === 'pumpStart' && (
        <label className="ef">
          <span>가속 시간 [s]</span>
          <input type="number" min={0} step={0.5} value={d.a} disabled={disabled} onChange={(e) => setD({ ...d, a: Number(e.target.value) })} />
        </label>
      )}
      {d.kind === 'valveStroke' && (
        <>
          <label className="ef">
            <span>목표 개도 [%]</span>
            <input type="number" min={0} max={100} step={5} value={d.a} disabled={disabled} onChange={(e) => setD({ ...d, a: Number(e.target.value) })} />
          </label>
          <label className="ef">
            <span>조작 시간 [s]</span>
            <input type="number" min={0} step={0.1} value={d.b} disabled={disabled} onChange={(e) => setD({ ...d, b: Number(e.target.value) })} />
          </label>
        </>
      )}
      {event && hint?.(event)}
      <button className="wide" disabled={disabled || !event} onClick={() => event && onSubmit(event)}>
        {submitLabel}
      </button>
    </div>
  );
}
