import { useMemo } from 'react';
import { useAppStore } from './store';
import { tileAt } from '../grid/ops';
import { KIND_LABEL } from './kindLabels';
import { reservoirThroughput } from '../analysis/networkVulnerability';

/** Below this, treat the network as delivering nothing (vs. floating-point
 * noise from a converged-but-idle solve). */
const NO_DELIVERY_THRESHOLD = 1e-5;

/** Bottom instrument strip: solver state and the cell/tile under the cursor.
 * The rest of the app shows numbers only on request (Inspector, Legend); this
 * is the one place they're always visible, the way a status bar is in any
 * engineering tool. */
export function StatusBar() {
  const grid = useAppStore((s) => s.grid);
  const compiled = useAppStore((s) => s.compiled);
  const hoverCell = useAppStore((s) => s.hoverCell);
  const solving = useAppStore((s) => s.solving);
  const result = useAppStore((s) => s.result);
  const issues = useAppStore((s) => s.issues);

  const hoverTile = hoverCell ? tileAt(grid, hoverCell) : undefined;
  const hasBlockingIssues = issues.some((i) => i.severity === 'error');

  const hasReservoir = compiled.network.nodes.some((n) => n.type === 'reservoir');
  const throughputM3h = useMemo(() => {
    if (!result || !hasReservoir) return null;
    return reservoirThroughput(compiled.network, result) * 3600;
  }, [result, compiled, hasReservoir]);
  const noDelivery = throughputM3h !== null && throughputM3h < NO_DELIVERY_THRESHOLD * 3600;

  let solverLabel = '대기';
  let solverClass = '';
  if (solving) {
    solverLabel = '계산 중…';
  } else if (hasBlockingIssues) {
    solverLabel = '구성 오류';
    solverClass = 'danger';
  } else if (result) {
    solverLabel = result.converged ? '수렴' : '수렴 실패';
    solverClass = result.converged ? 'ok' : 'danger';
  }

  return (
    <footer className="statusbar">
      <span className={`statusbar-dot ${solverClass}`} aria-hidden />
      <span>{solverLabel}</span>
      {result && (
        <>
          <span className="statusbar-sep" aria-hidden />
          <span>반복 {result.iterations}</span>
          <span className="statusbar-sep" aria-hidden />
          <span>잔차 {result.residual.toExponential(1)}</span>
        </>
      )}
      {throughputM3h !== null && (
        <>
          <span className="statusbar-sep" aria-hidden />
          <span className={noDelivery ? 'statusbar-danger' : undefined} title="소스/싱크로 실제 전달되는 순유량">
            송출 {throughputM3h.toFixed(2)} m³/h
          </span>
        </>
      )}

      <span className="statusbar-spacer" />

      {hoverCell && (
        <span className="statusbar-cell">
          ({hoverCell.col}, {hoverCell.row})
          {hoverTile && <> · {KIND_LABEL[hoverTile.kind]}</>}
        </span>
      )}

      <span className="statusbar-spacer" />
      <span className="statusbar-units">SI · m · m³/s · kPa</span>
    </footer>
  );
}
