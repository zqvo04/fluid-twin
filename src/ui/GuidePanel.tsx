import { useEffect, useMemo } from 'react';
import { useAppStore } from './store';
import { GUIDES } from '../learn/guides';
import { advance, guideContext } from '../learn/guide';
import { GRID_PRESETS } from '../examples/gridPresets';
import { solvedState } from './solved';

const REFERENCE = '개방형 냉각수 루프';

/**
 * Guided scenarios: one step card at a time. The step advances by itself
 * once its condition (a readout predicate, or the tab) holds.
 */
export function GuidePanel() {
  const guideState = useAppStore((s) => s.guide);
  const setGuide = useAppStore((s) => s.setGuide);
  const grid = useAppStore((s) => s.grid);
  const compiled = useAppStore((s) => s.compiled);
  const result = useAppStore((s) => s.result);
  const viewMode = useAppStore((s) => s.viewMode);
  const loadGrid = useAppStore((s) => s.loadGrid);
  const focusTile = useAppStore((s) => s.focusTile);

  const guide = GUIDES.find((g) => g.id === guideState?.id);
  const solved = useMemo(() => solvedState(result, grid), [result, grid]);

  useEffect(() => {
    if (!guide || !guideState || !solved) return;
    const next = advance(guide, guideState.step, guideContext(grid, compiled, solved, viewMode));
    if (next !== guideState.step) setGuide({ id: guide.id, step: next });
  }, [guide, guideState, solved, grid, compiled, viewMode, setGuide]);

  const start = (id: string) => {
    // The guides are written for the reference loop; don't drop the user's work silently.
    // eslint-disable-next-line no-alert
    if (grid.tiles.length && !confirm('가이드는 "개방형 냉각수 루프" 예제로 진행합니다. 지금 보드를 바꿀까요? (저장하지 않은 작업은 사라집니다)')) return;
    loadGrid(GRID_PRESETS.find((p) => p.name === REFERENCE)!.build());
    setGuide({ id, step: 0 });
  };

  const focusTag = (tag: string) => {
    const t = useAppStore.getState().grid.tiles.find((x) => 'tag' in x && x.tag === tag);
    const inst = useAppStore.getState().grid.instruments.find((i) => i.tag === tag);
    const id = t?.id ?? inst?.targetId;
    if (id) focusTile(id);
  };

  if (!guide || !guideState) {
    return (
      <div className="panel guide">
        <h1>가이드</h1>
        <p className="subtitle">운전 상황을 단계별로 따라 해 보기</p>
        {GUIDES.map((g) => (
          <button key={g.id} className="wide" onClick={() => start(g.id)}>
            {g.title}
          </button>
        ))}
      </div>
    );
  }

  const step = guide.steps[guideState.step];
  return (
    <div className="panel guide" aria-live="polite">
      <div className="inspector-head">
        <h1>{guide.title}</h1>
        <button onClick={() => setGuide(null)} aria-label="가이드 닫기">
          ✕
        </button>
      </div>
      {step ? (
        <>
          <p className="subtitle">
            {guideState.step + 1} / {guide.steps.length}
            {step.tab && ` · ${step.tab === 'pfd' ? 'PFD' : '맵'} 탭`}
          </p>
          <p>{step.text}</p>
          {step.target && (
            <button className="wide" onClick={() => focusTag(step.target!)}>
              {step.target} 보기
            </button>
          )}
        </>
      ) : (
        <p>완료했습니다. 다른 가이드를 해 보거나 직접 조작해 보세요.</p>
      )}
    </div>
  );
}
