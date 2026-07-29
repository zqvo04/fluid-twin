import { useMemo } from 'react';
import { useAppStore } from './store';
import { NOMINAL_SIZES } from '../domain/catalog/pipes';
import { VALVE_TYPES } from '../domain/catalog/valves';
import { computePressureField, tilePressure } from '../render/pressureField';

const KIND_LABEL: Record<string, string> = {
  straight: '직관',
  elbow: '엘보',
  tee: 'T자관',
  cross: '십자관',
  valve: '밸브',
  pump: '펌프',
  source: 'IN (소스)',
  sink: 'OUT (싱크)',
};

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
    const field = computePressureField(grid, compiled, result.heads);
    const p = tilePressure(tile.id, compiled, field);
    const linkId = compiled.tileLink.get(tile.id);
    const link = linkId ? result.links.get(linkId) : undefined;
    return { pressureKPa: p ? p.pa / 1000 : null, flow: link?.flow ?? null, velocity: link?.velocity ?? null };
  }, [tile, result, grid, compiled]);

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
