import { useMemo } from 'react';
import { useAppStore } from './store';
import { NOMINAL_SIZES } from '../domain/catalog/pipes';
import { VALVE_TYPES } from '../domain/catalog/valves';
import { hasCheckValve } from '../domain/network';
import { PumpHealth, PumpState } from '../analysis/pumpHealth';
import { pumpStressColor } from '../render/theme';
import { computePressureField, tilePressure } from '../render/pressureField';
import { KIND_LABEL } from './kindLabels';

/** What each pump condition means, in one line. */
const PUMP_STATE_LABEL: Record<PumpState, string> = {
  stopped: '정지',
  'dry-run': '공회전 (흡입 불가)',
  churn: '공회전 (토출 막힘)',
  cavitating: '캐비테이션',
  overload: '과부하 (runout)',
  'low-flow': '저유량',
  ok: '정상',
};

/**
 * Pump condition panel. The three rows that matter are the ones a symmetric
 * "head source" model cannot show: how much suction margin is left (NPSHa vs
 * NPSHr), how far the duty point is from BEP, and — when the pump is churning
 * — how long it has before the trapped liquid cooks it.
 */
function PumpReadout({ health: h }: { health: PumpHealth }) {
  const stressPct = Math.round(h.stress * 100);
  const churning = h.state === 'churn';
  return (
    <div className="readout pump-health">
      <div className="kv">
        <span>상태</span>
        <span style={{ color: h.state === 'stopped' ? undefined : pumpStressColor(h.stress), fontWeight: 700 }}>
          {PUMP_STATE_LABEL[h.state]}
        </span>
      </div>
      {h.state !== 'stopped' && (
        <>
          <div className="kv">
            <span>무리도</span>
            <span>{stressPct}%</span>
          </div>
          <div className="stress-bar" aria-hidden>
            <i style={{ width: `${stressPct}%`, background: pumpStressColor(h.stress) }} />
          </div>
          <div className="kv">
            <span>운전점</span>
            <span>{(h.bepRatio * 100).toFixed(0)}% BEP</span>
          </div>
          <div className="kv">
            <span>실양정</span>
            <span>{h.head.toFixed(1)} m</span>
          </div>
          <div className="kv">
            <span>흡입 / 토출</span>
            <span>
              {h.suctionGaugeHead.toFixed(1)} → {h.dischargeGaugeHead.toFixed(1)} m
            </span>
          </div>
          <div className="kv">
            <span>NPSHa / NPSHr</span>
            <span style={{ color: h.npshMargin < 0 ? pumpStressColor(1) : undefined }}>
              {h.npshAvailable.toFixed(1)} / {h.npshRequired.toFixed(1)} m
            </span>
          </div>
          {h.suctionFactor < 1 && (
            <div className="kv">
              <span>양정 저하</span>
              <span>커브의 {(h.suctionFactor * 100).toFixed(0)}%</span>
            </div>
          )}
          <div className="kv">
            <span>축동력</span>
            <span>{(h.shaftPower / 1000).toFixed(1)} kW</span>
          </div>
          {churning && (
            <>
              <div className="kv">
                <span>케이싱 온도상승</span>
                <span>{h.tempRiseRate.toFixed(2)} K/s</span>
              </div>
              <div className="kv">
                <span>15 K 도달까지</span>
                <span>{h.secondsToTempLimit.toFixed(0)} s</span>
              </div>
              <div className="kv">
                <span>열적 최소유량</span>
                <span>{(h.minThermalFlow * 3600).toFixed(1)} m³/h</span>
              </div>
            </>
          )}
        </>
      )}
      {h.state !== 'ok' && h.state !== 'stopped' && <p className="pump-note">{h.message}</p>}
    </div>
  );
}

export function Inspector() {
  const selectedTileId = useAppStore((s) => s.selectedTileId);
  const grid = useAppStore((s) => s.grid);
  const compiled = useAppStore((s) => s.compiled);
  const result = useAppStore((s) => s.result);
  const updateSelectedTile = useAppStore((s) => s.updateSelectedTile);
  const deleteSelected = useAppStore((s) => s.deleteSelected);
  const selectTile = useAppStore((s) => s.selectTile);

  const tile = grid.tiles.find((t) => t.id === selectedTileId);

  const readout = useMemo(() => {
    if (!tile || !result) return null;
    const field = computePressureField(grid, compiled, result.heads, result.links);
    const p = tilePressure(tile.id, grid, compiled, field);
    const linkId = compiled.tileLink.get(tile.id);
    const link = linkId ? result.links.get(linkId) : undefined;
    return { pressureKPa: p ? p.pa / 1000 : null, flow: link?.flow ?? null, velocity: link?.velocity ?? null };
  }, [tile, result, grid, compiled]);

  const pumpHealth = useMemo(() => {
    if (!tile || tile.kind !== 'pump' || !result) return null;
    const linkId = compiled.tileLink.get(tile.id);
    return linkId ? result.pumps.get(linkId) ?? null : null;
  }, [tile, result, compiled]);

  if (!tile) return null;

  return (
    <div className="panel inspector">
      <div className="inspector-head">
        <h1>{KIND_LABEL[tile.kind]}</h1>
        <button onClick={() => selectTile(null)} aria-label="Close">
          ✕
        </button>
      </div>
      <p className="subtitle">
        ({tile.cell.col}, {tile.cell.row}) · {tile.id}
      </p>

      {readout && (
        <div className="readout">
          {readout.pressureKPa !== null && (
            <div className="kv">
              <span>압력</span>
              <span>{readout.pressureKPa.toFixed(1)} kPa</span>
            </div>
          )}
          {readout.flow !== null && (
            <div className="kv">
              <span>유량</span>
              <span>{(readout.flow * 3600).toFixed(2)} m³/h</span>
            </div>
          )}
          {readout.velocity !== null && Number.isFinite(readout.velocity) && (
            <div className="kv">
              <span>유속</span>
              <span>{readout.velocity.toFixed(2)} m/s</span>
            </div>
          )}
        </div>
      )}

      {(tile.kind === 'straight' || tile.kind === 'elbow' || tile.kind === 'tee' || tile.kind === 'cross' || tile.kind === 'valve') && (
        <>
          <label className="ef">
            <span>구경</span>
            <select value={tile.nps} onChange={(e) => updateSelectedTile({ nps: e.target.value as (typeof NOMINAL_SIZES)[number] })}>
              {NOMINAL_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="ef">
            <span>스케줄</span>
            <select value={tile.schedule} onChange={(e) => updateSelectedTile({ schedule: e.target.value as '40' | '80' })}>
              <option value="40">40</option>
              <option value="80">80</option>
            </select>
          </label>
        </>
      )}

      {tile.kind === 'valve' && (
        <>
          <label className="ef">
            <span>종류</span>
            <select value={tile.valveType} onChange={(e) => updateSelectedTile({ valveType: e.target.value as (typeof VALVE_TYPES)[number] })}>
              {VALVE_TYPES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>
              개도 <b>{Math.round(tile.opening * 100)}%</b>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={tile.opening}
              onChange={(e) => updateSelectedTile({ opening: Number(e.target.value) })}
            />
          </label>
        </>
      )}

      {tile.kind === 'pump' && (
        <>
          <label className="field">
            <span>
              속도 <b>{Math.round(tile.speedRatio * 100)}%</b>
            </span>
            <input
              type="range"
              min={0}
              max={1.3}
              step={0.01}
              value={tile.speedRatio}
              onChange={(e) => updateSelectedTile({ speedRatio: Number(e.target.value) })}
            />
          </label>
          <label className="ef">
            <span>체크밸브</span>
            <input
              type="checkbox"
              checked={hasCheckValve(tile)}
              onChange={(e) => updateSelectedTile({ checkValve: e.target.checked })}
            />
          </label>
          {pumpHealth && <PumpReadout health={pumpHealth} />}
        </>
      )}

      {tile.kind === 'source' && (
        <label className="ef">
          <span>수두 [m]</span>
          <input type="number" value={tile.head} onChange={(e) => updateSelectedTile({ head: Number(e.target.value) })} />
        </label>
      )}

      {tile.kind === 'sink' && (
        <>
          <div className="segmented">
            <button className={tile.mode === 'head' ? 'active' : ''} onClick={() => updateSelectedTile({ mode: 'head' })}>
              고정 수두
            </button>
            <button className={tile.mode === 'demand' ? 'active' : ''} onClick={() => updateSelectedTile({ mode: 'demand' })}>
              고정 유량
            </button>
          </div>
          {tile.mode === 'head' ? (
            <label className="ef">
              <span>수두 [m]</span>
              <input type="number" value={tile.head} onChange={(e) => updateSelectedTile({ head: Number(e.target.value) })} />
            </label>
          ) : (
            <label className="ef">
              <span>유량 [m³/s]</span>
              <input type="number" step={0.001} value={tile.demand} onChange={(e) => updateSelectedTile({ demand: Number(e.target.value) })} />
            </label>
          )}
        </>
      )}

      <button className="wide danger" onClick={deleteSelected} style={{ marginTop: 12 }}>
        삭제
      </button>
    </div>
  );
}
