import { useState } from 'react';
import { useAppStore } from './store';
import { resolveIssueTile } from '../grid/compile';

export function WarningsPanel() {
  const [open, setOpen] = useState(false);
  const issues = useAppStore((s) => s.issues);
  const result = useAppStore((s) => s.result);
  const grid = useAppStore((s) => s.grid);
  const compiled = useAppStore((s) => s.compiled);
  const focusTile = useAppStore((s) => s.focusTile);

  // Structural issues (block re-solving) plus solved-network engineering
  // findings (hoop stress, erosion, NPSH, valve cavitation — informational,
  // computed after a converged solve, never gate the solver themselves).
  const allIssues = [...issues, ...(result?.findings ?? [])];

  const errorCount = allIssues.filter((i) => i.severity === 'error').length;
  const warnCount = allIssues.filter((i) => i.severity === 'warning').length;
  if (errorCount === 0 && warnCount === 0) return null;

  const onPick = (ref: string | undefined) => {
    const tileId = resolveIssueTile(ref, grid, compiled);
    if (tileId) focusTile(tileId);
    setOpen(false);
  };

  return (
    <div className="diag-dropdown-wrap">
      <div className="diag-badges" onClick={() => setOpen((v) => !v)} role="button" tabIndex={0}>
        {errorCount > 0 && <span className="badge danger">오류 {errorCount}</span>}
        {warnCount > 0 && <span className="badge warn">경고 {warnCount}</span>}
      </div>
      {open && (
        <div className="diag-dropdown">
          {allIssues.map((issue, i) => (
            <div
              key={i}
              className={`diag-item ${issue.severity}`}
              onClick={() => onPick(issue.ref)}
              role={issue.ref ? 'button' : undefined}
              tabIndex={issue.ref ? 0 : undefined}
            >
              <span className="dot" />
              {issue.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
