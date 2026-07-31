import { TileKind } from '../grid/types';

/** Korean display label for each tile kind — shared by the Inspector and the status bar. */
export const KIND_LABEL: Record<TileKind, string> = {
  straight: '직관',
  elbow: '엘보',
  tee: 'T자관',
  cross: '십자관',
  valve: '밸브',
  pump: '펌프',
  source: 'IN (소스)',
  sink: 'OUT (싱크)',
};
