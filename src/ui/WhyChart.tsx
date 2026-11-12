import { useMemo, useState } from 'react';
import { GridModel } from '../grid/types';
import { SolvedState } from '../readouts';
import { Point, pumpChart, valveChart } from '../learn/why';

const W = 236;
const H = 150;
const PAD = { l: 34, r: 8, t: 8, b: 26 };

/** Polyline path of points in data space mapped onto the plot box. */
function scaler(xMax: number, yMax: number) {
  const sx = (x: number) => PAD.l + (x / xMax) * (W - PAD.l - PAD.r);
  const sy = (y: number) => H - PAD.b - (y / yMax) * (H - PAD.t - PAD.b);
  return { sx, sy, path: (ps: Point[]) => ps.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('') };
}

function Axes({ xLabel, yLabel, xMax, yMax }: { xLabel: string; yLabel: string; xMax: number; yMax: number }) {
  return (
    <g fontSize={9} fill="currentColor">
      <path d={`M${PAD.l},${PAD.t}V${H - PAD.b}H${W - PAD.r}`} stroke="currentColor" fill="none" opacity={0.5} />
      <text x={PAD.l} y={H - 6}>0</text>
      <text x={W - PAD.r} y={H - 6} textAnchor="end">
        {xMax.toFixed(0)} {xLabel}
      </text>
      <text x={PAD.l - 4} y={PAD.t + 8} textAnchor="end">
        {yMax.toFixed(0)}
      </text>
      <text x={4} y={PAD.t + 20}>{yLabel}</text>
    </g>
  );
}

/**
 * "왜?" panel: why the element runs where it does. Pump — its curve against
 * the system curve; valve — flow vs opening. Opened on demand: each chart
 * re-solves the network a handful of times.
 */
export function WhyChart({ grid, result, tileId }: { grid: GridModel; result: SolvedState; tileId: string }) {
  const [open, setOpen] = useState(false);
  const tile = grid.tiles.find((t) => t.id === tileId);
  const data = useMemo(() => {
    if (!open || !tile) return null;
    return tile.kind === 'pump' ? { pump: pumpChart(grid, result, tileId) } : { valve: valveChart(grid, result, tileId) };
  }, [open, grid, result, tileId, tile]);

  return (
    <div className="section">
      <button className="wide" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        왜? {tile?.kind === 'pump' ? '운전점 차트' : '개도–유량 차트'} {open ? '▴' : '▾'}
      </button>
      {data?.pump && (() => {
        const c = data.pump;
        const xMax = Math.max(...c.pump.map((p) => p.x), ...c.system.map((p) => p.x), c.duty.x) * 1.05;
        const yMax = Math.max(...c.pump.map((p) => p.y), ...c.system.map((p) => p.y)) * 1.1;
        const { sx, sy, path } = scaler(xMax, yMax);
        return (
          <svg width={W} height={H} role="img" aria-label="펌프 곡선과 시스템 곡선의 교점이 운전점">
            <Axes xLabel="m³/h" yLabel="H m" xMax={xMax} yMax={yMax} />
            <path d={path(c.pump)} stroke="#5b4fc4" strokeWidth={2} fill="none" />
            <path d={path(c.system)} stroke="#e0a100" strokeWidth={2} fill="none" />
            <circle cx={sx(c.duty.x)} cy={sy(c.duty.y)} r={4} fill="#d93a2b" />
            <text x={sx(c.duty.x) + 6} y={sy(c.duty.y) - 6} fontSize={9} fill="currentColor">
              {c.duty.x.toFixed(1)} m³/h · {c.duty.y.toFixed(1)} m
            </text>
            <g fontSize={9}>
              <text x={W - PAD.r} y={PAD.t + 8} textAnchor="end" fill="#5b4fc4">펌프 곡선</text>
              <text x={W - PAD.r} y={PAD.t + 20} textAnchor="end" fill="#e0a100">시스템 곡선</text>
            </g>
          </svg>
        );
      })()}
      {data?.valve && (() => {
        const c = data.valve;
        const yMax = Math.max(...c.curve.map((p) => p.y), c.now.y, 1) * 1.1;
        const { sx, sy, path } = scaler(100, yMax);
        return (
          <svg width={W} height={H} role="img" aria-label="밸브 개도에 따른 유량">
            <Axes xLabel="% 개도" yLabel="Q m³/h" xMax={100} yMax={yMax} />
            <path d={path(c.curve)} stroke="#dd9f00" strokeWidth={2} fill="none" />
            <circle cx={sx(c.now.x)} cy={sy(c.now.y)} r={4} fill="#d93a2b" />
            <text x={sx(c.now.x) + 6} y={sy(c.now.y) + 12} fontSize={9} fill="currentColor">
              {c.now.x.toFixed(0)} % · {c.now.y.toFixed(1)} m³/h
            </text>
          </svg>
        );
      })()}
      {open && data && !data.pump && !data.valve && <p className="subtitle">정지 중이거나 해석 결과가 없어 차트를 그릴 수 없습니다.</p>}
    </div>
  );
}
