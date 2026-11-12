/**
 * Learning glossary (PLAN-V2 §1.3): for every tile and instrument kind, the
 * easy name shown first on the map, a one-line explanation, and how to read
 * its PFD symbol and tag. Plain data, Korean.
 */

import { InstrumentType, TileKind } from '../grid/types';

export interface GlossaryEntry {
  /** Easy name (map mode puts it first, the tag second). */
  name: string;
  /** What it does, in one line. */
  what: string;
  /** How to read its PFD symbol. */
  symbol: string;
  /** How to read its tag; empty for piping, which carries a line number instead. */
  tag: string;
}

const LINE = '배관은 태그 대신 라인 번호를 단다: 4"-CW-101 = 4인치 · 냉각수(CW) · 유닛 100의 01번 라인.';

export const GLOSSARY: Record<TileKind | InstrumentType, GlossaryEntry> = {
  straight: { name: '직관', what: '물이 지나가는 곧은 관. 길수록 마찰로 압력이 조금씩 떨어진다.', symbol: 'PFD에서는 굵은 실선 한 줄.', tag: LINE },
  elbow: { name: '엘보', what: '흐름 방향을 90° 꺾는 관. 꺾일 때 약간의 압력 손실이 생긴다.', symbol: '선이 직각으로 꺾인 곳.', tag: LINE },
  tee: { name: 'T자관', what: '흐름을 둘로 나누거나 둘을 하나로 합친다.', symbol: '세 갈래로 만나는 선.', tag: LINE },
  cross: { name: '십자관', what: '네 방향 배관이 한 점에서 만난다.', symbol: '네 갈래로 만나는 선.', tag: LINE },
  valve: {
    name: '밸브',
    what: '열림 정도(개도)로 유량을 조절한다. 닫을수록 저항이 커져 유량이 준다.',
    symbol: '삼각형 두 개가 맞닿은 나비넥타이 모양(ISO 10628-2). 가운데 점 = 글로브, 원 = 볼, 사선 = 버터플라이. 위에 반원(액추에이터)이 있으면 자동 제어밸브(ISA-5.1).',
    tag: 'FCV-101 = Flow Control Valve(유량 제어밸브), HV-102 = Hand Valve(수동밸브). 1 = 유닛 100, 01·02 = 순번.',
  },
  pump: {
    name: '펌프',
    what: '물에 압력(양정)을 더해 높은 곳·먼 곳까지 보낸다. 유량이 늘수록 낼 수 있는 양정은 준다.',
    symbol: '원 안의 삼각형(ISO 10628-2 원심펌프). 삼각형 꼭짓점이 토출(내보내는) 쪽.',
    tag: 'P-101A = Pump, 유닛 100의 1번 서비스, A = 운전기. 같은 일을 하는 예비기는 P-101B.',
  },
  source: { name: '공급 경계', what: '계통 밖에서 일정한 수두로 물이 들어오는 지점.', symbol: '오각형 화살표(경계 연결) — 다른 도면/계통에서 이어짐.', tag: '' },
  sink: { name: '배출 경계', what: '계통 밖으로 물이 나가는 지점(일정 수두 또는 일정 유량).', symbol: '오각형 화살표(경계 연결) — 다른 도면/계통으로 이어짐.', tag: '' },
  basin: {
    name: '냉각탑 수조',
    what: '냉각탑 아래 물을 모아 두는 개방 탱크. 펌프가 여기서 빨아들이고, 살수된 물이 다시 떨어진다. 들어오는 양과 나가는 양이 다르면 수위가 변한다.',
    symbol: '위가 열린 사각형과 ▽ 수위 표시(ISO 10628-2 개방 탱크).',
    tag: 'TK-101 = Tank, 유닛 100의 01번.',
  },
  strainer: {
    name: '스트레이너',
    what: '펌프 흡입 쪽에서 이물질을 거르는 망. 막힐수록 압력 손실이 커져 펌프가 빨아들이기 힘들어진다.',
    symbol: '사각형 안의 점선 대각선(망)(ISO 10628-2).',
    tag: 'S-101 = Strainer, 유닛 100의 01번.',
  },
  hx: {
    name: '열교환기',
    what: '공정의 열을 냉각수로 옮기는 장치. 여기서는 온도는 다루지 않고, 지날 때 생기는 압력 손실만 계산한다.',
    symbol: '긴 캡슐(셸) 안에 U자 관 다발(ISO 10628-2 셸앤튜브).',
    tag: 'E-101 = Exchanger, 유닛 100의 01번.',
  },
  spray: {
    name: '냉각탑 살수부',
    what: '냉각탑 꼭대기에서 물을 뿌리는 헤더. 대기로 방출된 물은 수조로 떨어져 다시 순환한다.',
    symbol: '사다리꼴(냉각탑) 안의 가로 헤더와 아래로 퍼지는 분사선.',
    tag: 'CT-101 = Cooling Tower, 유닛 100의 01번.',
  },
  FI: {
    name: '유량계',
    what: '그 지점을 지나는 유량을 보여 주는 지시계.',
    symbol: '원(버블) 위 칸에 기능 문자, 아래 칸에 루프 번호(ISA-5.1). 가로줄 없음 = 현장 설치.',
    tag: 'FI-101 = Flow Indicator(유량 지시), 루프 101.',
  },
  PI: {
    name: '압력계',
    what: '그 지점의 압력(게이지압)을 보여 주는 지시계.',
    symbol: '원 안 위 PI, 아래 루프 번호(ISA-5.1).',
    tag: 'PI-101 = Pressure Indicator(압력 지시), 루프 101.',
  },
  LI: {
    name: '수위계',
    what: '수조의 수위를 보여 주는 지시계.',
    symbol: '원 안 위 LI, 아래 루프 번호(ISA-5.1).',
    tag: 'LI-101 = Level Indicator(수위 지시), 루프 101.',
  },
  FIC: {
    name: '유량 지시 조절계',
    what: '유량을 보여 주고 제어밸브를 조절하는 계기. 이 모델에서는 지시만 하고, 밸브는 사용자가 직접 움직인다.',
    symbol: '원 가운데 가로줄 = 제어실(운전원 화면)에 있는 계기(ISA-5.1).',
    tag: 'FIC-101 = Flow Indicating Controller, 루프 101.',
  },
};

/**
 * Easy name of one element: the kind's name, refined by what its tag says —
 * A/B for a duty/standby pump, control vs hand for a valve.
 */
export function easyName(kind: TileKind | InstrumentType, tag?: string): string {
  if (kind === 'valve' && tag) return tag.startsWith('FCV') ? '제어밸브' : tag.startsWith('HV') ? '수동밸브' : GLOSSARY.valve.name;
  const ab = kind === 'pump' && tag ? /([AB])$/.exec(tag)?.[1] : undefined;
  return ab ? `${GLOSSARY[kind].name} ${ab}` : GLOSSARY[kind].name;
}
