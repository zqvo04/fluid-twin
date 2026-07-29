import { useAppStore } from './store';
import { useTransientRunner } from './useTransientRunner';
import { TransientChart } from './TransientChart';

export function TransientPanel() {
  const grid = useAppStore((s) => s.grid);
  const compiled = useAppStore((s) => s.compiled);
  const transient = useAppStore((s) => s.transient);
  const setTransientTarget = useAppStore((s) => s.setTransientTarget);
  const setTransientClosureTime = useAppStore((s) => s.setTransientClosureTime);
  const setTransientSeconds = useAppStore((s) => s.setTransientSeconds);
  const { start, stop } = useTransientRunner();

  const valves = grid.tiles.filter((t) => t.kind === 'valve');
  const pumps = grid.tiles.filter((t) => t.kind === 'pump');
  if (valves.length === 0 && pumps.length === 0) return null;

  const onStart = () => {
    if (!transient.targetId) return;
    if (transient.targetKind === 'valve') start({ valveId: transient.targetId });
    else start({ pumpTripId: transient.targetId });
  };

  return (
    <div className="panel transient-panel">
      <h1>수격 해석</h1>
      <p className="subtitle">밸브 급폐쇄 또는 펌프 정전을 시뮬레이션합니다</p>

      <div className="section">
        <h2>트리거</h2>
        {valves.length > 0 && (
          <>
            <p className="hint">밸브 폐쇄</p>
            <div className="target-list">
              {valves.map((t) => {
                const linkId = compiled.tileLink.get(t.id);
                const active = transient.targetKind === 'valve' && transient.targetId === linkId;
                return (
                  <button
                    key={t.id}
                    className={active ? 'active' : ''}
                    disabled={!linkId || transient.running}
                    onClick={() => linkId && setTransientTarget('valve', linkId)}
                  >
                    {t.id} ({t.cell.col},{t.cell.row})
                  </button>
                );
              })}
            </div>
          </>
        )}
        {pumps.length > 0 && (
          <>
            <p className="hint">펌프 정전(트립)</p>
            <div className="target-list">
              {pumps.map((t) => {
                const linkId = compiled.tileLink.get(t.id);
                const active = transient.targetKind === 'pump' && transient.targetId === linkId;
                return (
                  <button
                    key={t.id}
                    className={active ? 'active' : ''}
                    disabled={!linkId || transient.running}
                    onClick={() => linkId && setTransientTarget('pump', linkId)}
                  >
                    {t.id} ({t.cell.col},{t.cell.row})
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {transient.targetKind === 'valve' && (
        <label className="field">
          <span>
            폐쇄 시간 <b>{transient.closureTimeS.toFixed(2)} s</b>
          </span>
          <input
            type="range"
            min={0.05}
            max={3}
            step={0.05}
            value={transient.closureTimeS}
            disabled={transient.running}
            onChange={(e) => setTransientClosureTime(Number(e.target.value))}
          />
        </label>
      )}

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

      <div className="segmented" style={{ marginTop: 8 }}>
        <button disabled={!transient.targetId || transient.running} onClick={onStart}>
          시작
        </button>
        <button disabled={!transient.running} onClick={stop}>
          정지
        </button>
      </div>

      {(transient.running || transient.history.length > 0) && (
        <div className="section">
          <h2>진행 상황</h2>
          <div className="kv">
            <span>시간</span>
            <span>{transient.time.toFixed(2)} s</span>
          </div>
          <div className="kv">
            <span>최대 수두</span>
            <span>{transient.maxHead.toFixed(1)} m</span>
          </div>
          <div className="kv">
            <span>최소 수두</span>
            <span>{transient.minHead.toFixed(1)} m</span>
          </div>
          <div className="kv">
            <span>최대 서지</span>
            <span>{transient.peakSurge.toFixed(1)} m</span>
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
