import { useAppStore } from './store';
import { TileKind } from '../grid/types';
import { NOMINAL_SIZES } from '../domain/catalog/pipes';
import { VALVE_TYPES } from '../domain/catalog/valves';

const PIECES: Array<{ kind: TileKind; label: string; hint: string }> = [
  { kind: 'straight', label: '직관', hint: 'Straight pipe' },
  { kind: 'elbow', label: '엘보', hint: '90° bend' },
  { kind: 'tee', label: 'T자관', hint: 'Tee junction' },
  { kind: 'cross', label: '십자관', hint: '4-way junction' },
  { kind: 'valve', label: '밸브', hint: 'Flow control' },
  { kind: 'pump', label: '펌프', hint: 'Adds head' },
  { kind: 'source', label: 'IN', hint: 'Fixed-head source' },
  { kind: 'sink', label: 'OUT', hint: 'Outlet / demand' },
];

export function Palette() {
  const mode = useAppStore((s) => s.mode);
  const armedKind = useAppStore((s) => s.armedKind);
  const armedRotation = useAppStore((s) => s.armedRotation);
  const tileDefaults = useAppStore((s) => s.tileDefaults);
  const setMode = useAppStore((s) => s.setMode);
  const setArmedKind = useAppStore((s) => s.setArmedKind);
  const rotateArmed = useAppStore((s) => s.rotateArmed);
  const setTileDefaults = useAppStore((s) => s.setTileDefaults);

  return (
    <div className="panel palette">
      <h1>부품</h1>
      <p className="subtitle">클릭해서 배치 · R로 회전</p>

      <div className="piece-grid">
        {PIECES.map((p) => (
          <button
            key={p.kind}
            className={mode === 'place' && armedKind === p.kind ? 'piece active' : 'piece'}
            title={p.hint}
            onClick={() => setArmedKind(p.kind)}
          >
            <span className={`piece-icon piece-icon-${p.kind}`} style={{ transform: `rotate(${armedKind === p.kind ? armedRotation : 0}deg)` }} />
            {p.label}
          </button>
        ))}
      </div>

      <div className="segmented" role="tablist" style={{ marginTop: 12 }}>
        <button role="tab" aria-selected={mode === 'select'} className={mode === 'select' ? 'active' : ''} onClick={() => setMode('select')}>
          선택
        </button>
        <button role="tab" aria-selected={mode === 'delete'} className={mode === 'delete' ? 'active' : ''} onClick={() => setMode('delete')}>
          삭제
        </button>
        <button onClick={rotateArmed}>회전 ↻</button>
      </div>

      <div className="section">
        <h2>기본 사양</h2>
        <label className="ef">
          <span>구경</span>
          <select value={tileDefaults.nps} onChange={(e) => setTileDefaults({ nps: e.target.value as typeof tileDefaults.nps })}>
            {NOMINAL_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="ef">
          <span>스케줄</span>
          <select value={tileDefaults.schedule} onChange={(e) => setTileDefaults({ schedule: e.target.value as typeof tileDefaults.schedule })}>
            <option value="40">40</option>
            <option value="80">80</option>
          </select>
        </label>
        <label className="ef">
          <span>밸브 종류</span>
          <select value={tileDefaults.valveType} onChange={(e) => setTileDefaults({ valveType: e.target.value as typeof tileDefaults.valveType })}>
            {VALVE_TYPES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
