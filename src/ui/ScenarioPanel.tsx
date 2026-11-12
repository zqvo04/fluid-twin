import { useState } from 'react';
import { activeFrame, useAppStore } from './store';
import { useScenarioRunner } from './useScenarioRunner';
import { GridModel, ScenarioEvent, Tile } from '../grid/types';

type Kind = ScenarioEvent['kind'];
const KIND_LABEL: Record<Kind, string> = { pumpStart: '펌프 기동', pumpStop: '펌프 정지', valveStroke: '밸브 조작' };

const tagOf = (grid: GridModel, id: string) => {
  const t = grid.tiles.find((x) => x.id === id);
  return t && 'tag' in t ? t.tag : id;
};

function describe(grid: GridModel, e: ScenarioEvent): string {
  const head = `${e.t} s · ${tagOf(grid, e.id)} ${KIND_LABEL[e.kind]}`;
  if (e.kind === 'pumpStart') return `${head} (${e.rampS} s에 걸쳐)`;
  if (e.kind === 'valveStroke') return `${head} → ${Math.round(e.target * 100)} % (${e.timeS} s)`;
  return `${head} (관성 감속)`;
}

/** Ready-made scenarios for the reference loop, offered when its tags are present. */
function examples(grid: GridModel): Array<{ name: string; events: ScenarioEvent[] }> {
  const id = (tag: string) => grid.tiles.find((t) => 'tag' in t && t.tag === tag)?.id;
  const [a, b, fcv] = [id('P-101A'), id('P-101B'), id('FCV-101')];
  const out: Array<{ name: string; events: ScenarioEvent[] }> = [];
  if (a && b) {
    out.push({
      name: '펌프 A → B 전환',
      events: [
        { kind: 'pumpStart', t: 2, id: b, rampS: 5 },
        { kind: 'pumpStop', t: 12, id: a },
      ],
    });
  }
  if (fcv) out.push({ name: 'FCV-101 30 %로 조임', events: [{ kind: 'valveStroke', t: 2, id: fcv, target: 0.3, timeS: 10 }] });
  return out;
}

/**
 * Scenario playback (PLAN-V2 §2.2 main timeline): list timed events, run the
 * quasi-steady runner in the worker, then scrub through the frames. Both
 * tabs, the Inspector and the particles follow the frame on screen.
 */
export function ScenarioPanel() {
  const grid = useAppStore((s) => s.grid);
  const playback = useAppStore((s) => s.playback);
  const frame = useAppStore(activeFrame);
  const seekFrame = useAppStore((s) => s.seekFrame);
  const clearPlayback = useAppStore((s) => s.clearPlayback);
  const { start, stop } = useScenarioRunner();

  const [events, setEvents] = useState<ScenarioEvent[]>([]);
  const [durationS, setDurationS] = useState(30);
  const [draft, setDraft] = useState<{ kind: Kind; id: string; t: number; a: number; b: number }>({
    kind: 'pumpStart',
    id: '',
    t: 2,
    a: 5,
    b: 10,
  });

  const pumps = grid.tiles.filter((t) => t.kind === 'pump');
  const valves = grid.tiles.filter((t) => t.kind === 'valve');
  if (!pumps.length && !valves.length) return null;

  const targets: Tile[] = draft.kind === 'valveStroke' ? valves : pumps;
  const targetId = targets.some((t) => t.id === draft.id) ? draft.id : targets[0]?.id ?? '';
  const running = playback?.running === true;
  const stale = playback !== null && playback.grid !== grid; // grid edited since the run

  const add = () => {
    if (!targetId) return;
    const t = Math.max(0, draft.t);
    const e: ScenarioEvent =
      draft.kind === 'pumpStart'
        ? { kind: 'pumpStart', t, id: targetId, rampS: Math.max(0, draft.a) }
        : draft.kind === 'pumpStop'
          ? { kind: 'pumpStop', t, id: targetId }
          : { kind: 'valveStroke', t, id: targetId, target: Math.min(1, Math.max(0, draft.a / 100)), timeS: Math.max(0, draft.b) };
    setEvents([...events, e].sort((x, y) => x.t - y.t));
  };

  return (
    <div className="panel scenario">
      <h1>시나리오</h1>
      <p className="subtitle">시간에 따른 운전 조작을 0.5 s 간격으로 재생</p>

      {examples(grid).map((x) => (
        <button key={x.name} className="wide" disabled={running} onClick={() => setEvents(x.events)}>
          예: {x.name}
        </button>
      ))}

      <div className="section">
        <h2>이벤트</h2>
        {events.length === 0 && <p className="hint">아래에서 이벤트를 추가하세요.</p>}
        {events.map((e, i) => (
          <div className="kv" key={i}>
            <span>{describe(grid, e)}</span>
            <button aria-label="이벤트 삭제" disabled={running} onClick={() => setEvents(events.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="section">
        <label className="ef">
          <span>동작</span>
          <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Kind, a: e.target.value === 'valveStroke' ? 30 : 5 })}>
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
              <option key={k} value={k} disabled={k === 'valveStroke' ? !valves.length : !pumps.length}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="ef">
          <span>대상</span>
          <select value={targetId} onChange={(e) => setDraft({ ...draft, id: e.target.value })}>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {'tag' in t ? t.tag : t.id}
              </option>
            ))}
          </select>
        </label>
        <label className="ef">
          <span>시각 [s]</span>
          <input type="number" min={0} step={0.5} value={draft.t} onChange={(e) => setDraft({ ...draft, t: Number(e.target.value) })} />
        </label>
        {draft.kind === 'pumpStart' && (
          <label className="ef">
            <span>가속 시간 [s]</span>
            <input type="number" min={0} step={0.5} value={draft.a} onChange={(e) => setDraft({ ...draft, a: Number(e.target.value) })} />
          </label>
        )}
        {draft.kind === 'valveStroke' && (
          <>
            <label className="ef">
              <span>목표 개도 [%]</span>
              <input type="number" min={0} max={100} step={5} value={draft.a} onChange={(e) => setDraft({ ...draft, a: Number(e.target.value) })} />
            </label>
            <label className="ef">
              <span>스트로크 시간 [s]</span>
              <input type="number" min={0} step={0.5} value={draft.b} onChange={(e) => setDraft({ ...draft, b: Number(e.target.value) })} />
            </label>
          </>
        )}
        <button className="wide" disabled={running || !targetId} onClick={add}>
          이벤트 추가
        </button>
      </div>

      <div className="section">
        <label className="ef">
          <span>재생 길이 [s]</span>
          <input type="number" min={1} max={600} step={1} value={durationS} onChange={(e) => setDurationS(Math.min(600, Math.max(1, Number(e.target.value))))} />
        </label>
        {running ? (
          <button className="wide" onClick={stop}>
            중지
          </button>
        ) : (
          <button className="wide" disabled={!events.length} onClick={() => start(events, durationS)}>
            재생
          </button>
        )}
      </div>

      {playback && !stale && playback.frames.length > 0 && (
        <div className="section" aria-live="polite">
          <label className="field">
            <span>
              t = <b>{frame?.t.toFixed(1)} s</b> {running ? '(계산 중)' : ''}
            </span>
            <input
              type="range"
              min={0}
              max={playback.frames.length - 1}
              step={1}
              value={playback.index}
              disabled={running}
              onChange={(e) => seekFrame(Number(e.target.value))}
              aria-label="재생 시각"
            />
          </label>
          <button className="wide" disabled={running} onClick={clearPlayback}>
            정상 상태로 돌아가기
          </button>
        </div>
      )}
      {stale && <p className="hint">보드를 고쳐서 재생 결과를 지웠습니다. 다시 재생하세요.</p>}
    </div>
  );
}
