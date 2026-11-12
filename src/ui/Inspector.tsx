import { useMemo } from 'react';
import { useAppStore } from './store';
import { NOMINAL_SIZES } from '../domain/catalog/pipes';
import { VALVE_TYPES } from '../domain/catalog/valves';
import { hasCheckValve } from '../domain/network';
import { PumpHealth, PumpState } from '../analysis/pumpHealth';
import { pumpStressColor } from '../render/theme';
import { elementReadout } from '../readouts';
import { GLOSSARY, easyName } from '../learn/glossary';
import { nextTag, tagCode } from '../grid/tags';
import { m3hToM3s, m3sToM3h } from '../domain/units';
import { useDisplayState } from './solved';
import { WhyChart } from './WhyChart';

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
  const viewMode = useAppStore((s) => s.viewMode);


  // Same numbers as both canvases: readouts.ts is the only source (§1.2) —
  // during playback, the frame's numbers on the grid as it stands then.
  const { grid: shown, solved, playing } = useDisplayState();
  // During playback the panel shows the tile as it stands at the frame (speed,
  // opening, level) and is read-only: the scenario, not the editor, sets them.
  const tile = shown.tiles.find((t) => t.id === selectedTileId);
  const readout = useMemo(
    () => (tile && solved ? elementReadout(shown, compiled, solved, tile.id) : null),
    [tile, solved, shown, compiled],
  );

  const pumpHealth = useMemo(() => {
    if (!tile || tile.kind !== 'pump' || !result) return null;
    const linkId = compiled.tileLink.get(tile.id);
    return linkId ? result.pumps.get(linkId) ?? null : null;
  }, [tile, result, compiled]);

  if (!tile) return null;
  const tag = 'tag' in tile ? tile.tag : undefined;
  const name = easyName(tile.kind, tag);
  const g = GLOSSARY[tile.kind];
  const num = (v: number | undefined, unit: string, d: number) =>
    v === undefined || !Number.isFinite(v) ? null : `${v.toFixed(d)} ${unit}`;
  const rows: Array<[string, string | null]> = readout
    ? [
        ['압력', num(readout.pressureBarG, 'bar g', 3)],
        ['입구 압력', num(readout.inletPressureBarG, 'bar g', 3)],
        ['유량', num(readout.flowM3h, 'm³/h', 1)],
        ['유속', num(readout.velocityMs, 'm/s', 2)],
        ['차압', tile.kind === 'pump' ? null : num(readout.dpBar, 'bar', 3)],
        ['양정', num(readout.headM, 'm', 1)],
        ['수위', num(readout.levelM, 'm', 2)],
      ]
    : [];

  return (
    <div className="panel inspector">
      <div className="inspector-head">
        {/* Dual label: tag first on the PFD, easy name first on the map (§1.3). */}
        <h1>{viewMode === 'pfd' && tag ? tag : name}</h1>
        <button onClick={() => selectTile(null)} aria-label="Close">
          ✕
        </button>
      </div>
      <p className="subtitle">
        {tag ? (viewMode === 'pfd' ? name : tag) : `(${tile.cell.col}, ${tile.cell.row})`} · {tile.id}
      </p>

      {viewMode === 'pfd' && (
        <div className="readout glossary">
          <p>
            <b>기호</b> {g.symbol}
          </p>
          {g.tag && (
            <p>
              <b>태그</b> {g.tag}
            </p>
          )}
          <p>{g.what}</p>
        </div>
      )}

      {rows.some(([, v]) => v) && (
        <div className="readout">
          {rows.map(([k, v]) =>
            v ? (
              <div className="kv" key={k}>
                <span>{k}</span>
                <span>{v}</span>
              </div>
            ) : null,
          )}
        </div>
      )}

      {playing && <p className="hint">시나리오 재생 중: 이 시각의 상태입니다(편집 잠금).</p>}
      <fieldset className="plain" disabled={playing}>
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
          <label className="ef">
            <span>역할</span>
            <select
              value={tile.service}
              onChange={(e) => {
                // A role change is a different tag code (FCV ↔ HV): re-tag.
                const service = e.target.value as 'control' | 'manual';
                const others = { ...grid, tiles: grid.tiles.filter((t) => t.id !== tile.id) };
                updateSelectedTile({ service, tag: nextTag(others, tagCode({ ...tile, service })) });
              }}
            >
              <option value="control">제어밸브 (FCV)</option>
              <option value="manual">수동밸브 (HV)</option>
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
            <span>운전</span>
            <input type="checkbox" checked={tile.running} onChange={(e) => updateSelectedTile({ running: e.target.checked })} />
          </label>
          <label className="ef">
            <span>체크밸브</span>
            <input
              type="checkbox"
              checked={hasCheckValve(tile)}
              onChange={(e) => updateSelectedTile({ checkValve: e.target.checked })}
            />
          </label>
          {/* Pump health is a steady-solve verdict, not a played-back moment's. */}
          {pumpHealth && !playing && <PumpReadout health={pumpHealth} />}
        </>
      )}

      {tile.kind === 'basin' && (
        <>
          <label className="ef">
            <span>수면적 [m²]</span>
            <input type="number" min={0.1} step={1} value={tile.area} onChange={(e) => updateSelectedTile({ area: Math.max(0.1, Number(e.target.value)) })} />
          </label>
          <label className="ef">
            <span>수위 [m]</span>
            <input type="number" min={0} step={0.1} value={tile.level} onChange={(e) => updateSelectedTile({ level: Math.max(0, Number(e.target.value)) })} />
          </label>
        </>
      )}

      {tile.kind === 'strainer' && (
        <>
          <label className="ef">
            <span>청정 K</span>
            <input type="number" min={0} step={0.1} value={tile.kClean} onChange={(e) => updateSelectedTile({ kClean: Math.max(0, Number(e.target.value)) })} />
          </label>
          <label className="field">
            <span>
              막힘 <b>{Math.round(tile.clogging * 100)}%</b>
            </span>
            <input type="range" min={0} max={0.95} step={0.01} value={tile.clogging} onChange={(e) => updateSelectedTile({ clogging: Number(e.target.value) })} />
          </label>
        </>
      )}

      {tile.kind === 'hx' && (
        <>
          <label className="ef">
            <span>설계 유량 [m³/h]</span>
            <input
              type="number"
              min={1}
              step={1}
              value={Math.round(m3sToM3h(tile.designFlow))}
              onChange={(e) => updateSelectedTile({ designFlow: m3hToM3s(Math.max(1, Number(e.target.value))) })}
            />
          </label>
          <label className="ef">
            <span>설계 차압 [kPa]</span>
            <input
              type="number"
              min={1}
              step={1}
              value={Math.round(tile.designDp / 1000)}
              onChange={(e) => updateSelectedTile({ designDp: Math.max(1, Number(e.target.value)) * 1000 })}
            />
          </label>
        </>
      )}

      {tile.kind === 'spray' && (
        <>
          <label className="ef">
            <span>노즐 K</span>
            <input type="number" min={0} step={0.1} value={tile.nozzleK} onChange={(e) => updateSelectedTile({ nozzleK: Math.max(0, Number(e.target.value)) })} />
          </label>
          <label className="ef">
            <span>복귀 수조</span>
            <select value={tile.returnBasinId} onChange={(e) => updateSelectedTile({ returnBasinId: e.target.value })}>
              <option value="">—</option>
              {grid.tiles.map((t) =>
                t.kind === 'basin' ? (
                  <option key={t.id} value={t.id}>
                    {t.tag}
                  </option>
                ) : null,
              )}
            </select>
          </label>
        </>
      )}

      {solved && !playing && (tile.kind === 'pump' || tile.kind === 'valve') && <WhyChart grid={grid} result={solved} tileId={tile.id} />}

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

      </fieldset>

      <button className="wide danger" disabled={playing} onClick={deleteSelected} style={{ marginTop: 12 }}>
        삭제
      </button>
    </div>
  );
}
