import { useAppStore } from './store';
import { tileAt } from '../grid/ops';
import { KIND_LABEL } from './kindLabels';

/** Bottom instrument strip: solver state and the cell/tile under the cursor.
 * The rest of the app shows numbers only on request (Inspector, Legend); this
 * is the one place they're always visible, the way a status bar is in any
 * engineering tool. */
export function StatusBar() {
  const grid = useAppStore((s) => s.grid);
  const hoverCell = useAppStore((s) => s.hoverCell);
  const solving = useAppStore((s) => s.solving);
  const result = useAppStore((s) => s.result);
  const issues = useAppStore((s) => s.issues);

  const hoverTile = hoverCell ? tileAt(grid, hoverCell) : undefined;
  const hasBlockingIssues = issues.some((i) => i.severity === 'error');

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
