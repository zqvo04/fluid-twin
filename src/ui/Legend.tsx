import { useMemo } from 'react';
import { useAppStore } from './store';
import { computePressureField } from '../render/pressureField';
import { pressureColor } from '../render/theme';

const STOPS = [0, 0.25, 0.5, 0.75, 1];

export function Legend() {
  const grid = useAppStore((s) => s.grid);
  const compiled = useAppStore((s) => s.compiled);
  const result = useAppStore((s) => s.result);
  const solving = useAppStore((s) => s.solving);
  const showPressure = useAppStore((s) => s.showPressure);
  const togglePressure = useAppStore((s) => s.togglePressure);
  const showFlow = useAppStore((s) => s.showFlow);
  const toggleFlow = useAppStore((s) => s.toggleFlow);

  const field = useMemo(
    () => (result ? computePressureField(grid, compiled, result.heads, result.links) : null),
    [grid, compiled, result],
  );

  const gradientCss = `linear-gradient(90deg, ${STOPS.map((t) => pressureColor(t)).join(', ')})`;
  const hasCavitation = field ? [...field.nodePressure.values()].some((p) => p < 0) : false;

  return (
    <div className="legend">
      <div className="legend-row">
        <button className={showPressure ? 'active' : ''} onClick={togglePressure}>
          압력 오버레이
        </button>
        <button className={showFlow ? 'active' : ''} onClick={toggleFlow}>
          유동 애니메이션
        </button>
        {solving && <span className="legend-status">계산 중…</span>}
        {!solving && result && !result.converged && <span className="legend-status warn">수렴 실패</span>}
      </div>

      {showPressure && field && (
        <>
          <div className="legend-bar" style={{ background: gradientCss }} />
          <div className="legend-scale">
            <span>{(field.min / 1000).toFixed(0)} kPa</span>
            <span className="muted">저압 · 고압</span>
            <span>{(field.max / 1000).toFixed(0)} kPa</span>
          </div>
          {hasCavitation && <div className="legend-warn">⬤ 부압(캐비테이션 위험) 지점 있음</div>}
        </>
      )}
    </div>
  );
}
