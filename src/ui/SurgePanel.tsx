import { useMemo } from 'react';
import { useAppStore } from './store';
import { useTransientRunner } from './useTransientRunner';
import { TransientChart } from './TransientChart';
import { EventForm } from './EventForm';
import { networkEvents } from '../grid/scenario';
import { surgeCheckRecommended, surgeThreshold } from '../physics/networkTransient';
import { ownerOfNode } from '../readouts';
import { waterProperties } from '../domain/fluid';
import { G } from '../domain/units';

/**
 * Surge check (PLAN-V2 §2.2, second layer): one fast event — valve stroke,
 * pump trip, pump start — run through the MOC from the steady state, with the
 * pressure wave streamed onto the canvas. Says up front whether the event is
 * fast enough to need it (T < 10·2L/a) and, after, where the head peaked.
 */
export function SurgePanel() {
  const grid = useAppStore((s) => s.grid);
  const compiled = useAppStore((s) => s.compiled);
  const transient = useAppStore((s) => s.transient);
  const setTransientSeconds = useAppStore((s) => s.setTransientSeconds);
  const focusTile = useAppStore((s) => s.focusTile);
  const { start, stop } = useTransientRunner();

  const threshold = useMemo(() => surgeThreshold(compiled.network), [compiled]);
  if (!grid.tiles.some((t) => t.kind === 'pump' || t.kind === 'valve')) return null;

  const rho = waterProperties(grid.temperatureC).rho;
  const toBar = (m: number) => (rho * G * m) / 1e5;
  const peakTile = transient.peakNodeId ? ownerOfNode(compiled, transient.peakNodeId) : null;
  const peakTag = peakTile ? grid.tiles.find((t) => t.id === peakTile) : undefined;

  return (
    <div className="panel transient-panel">
      <h1>서지 점검</h1>
      <p className="subtitle">빠른 조작 한 번이 만드는 압력파(수격)를 확인합니다</p>

      <EventForm
        grid={grid}
        withTime={false}
        initialKind="valveStroke"
        disabled={transient.running}
        submitLabel="점검 시작"
        onSubmit={(e) => start(e)}
        hint={(e) => {
          const fast = surgeCheckRecommended(compiled.network, networkEvents(compiled, [e])[0]);
          return (
            <p className="hint">
              {fast ? <b className="badge warn">서지 점검 권장</b> : <b>완만한 조작</b>} — 기준 10·(2L/a) = {threshold.toFixed(1)} s
              {fast ? '보다 빠름' : ' 이상: 시나리오 재생으로 충분'}
            </p>
          );
        }}
      />

      <label className="field">
        <span>
          해석 구간 <b>{transient.seconds.toFixed(1)} s</b>
        </span>
        <input
          type="range"
          min={1}
          max={10}
          step={0.5}
          value={transient.seconds}
          disabled={transient.running}
          onChange={(e) => setTransientSeconds(Number(e.target.value))}
        />
      </label>
      {transient.running && (
        <button className="wide" onClick={stop}>
          정지
        </button>
      )}

      {(transient.running || transient.history.length > 0) && (
        <div className="section" aria-live="polite">
          <h2>{transient.running ? '진행 중' : '결과'}</h2>
          <div className="kv">
            <span>시간</span>
            <span>{transient.time.toFixed(2)} s</span>
          </div>
          <div className="kv">
            <span>최대 상승</span>
            <span>
              {transient.peakSurge.toFixed(1)} m ({toBar(transient.peakSurge).toFixed(2)} bar)
            </span>
          </div>
          {peakTile && (
            <div className="kv">
              <span>위치</span>
              <button onClick={() => focusTile(peakTile)}>{peakTag && 'tag' in peakTag ? peakTag.tag : '보기'}</button>
            </div>
          )}
          <div className="kv">
            <span>최대 / 최소 수두</span>
            <span>
              {transient.maxHead.toFixed(1)} / {transient.minHead.toFixed(1)} m
            </span>
          </div>
          <TransientChart history={transient.history} />
          <div className="chart-legend">
            <span>
              <i className="dot" style={{ background: '#e4527a' }} /> 최대
            </span>
            <span>
              <i className="dot" style={{ background: '#4ea8de' }} /> 최소
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
