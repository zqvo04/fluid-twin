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
  basin: '냉각탑 수조',
  strainer: '스트레이너',
  hx: '열교환기',
  spray: '살수 헤더',
};
