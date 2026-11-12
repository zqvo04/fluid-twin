/**
 * Guide content for the reference open cooling loop ("개방형 냉각수 루프").
 * The figures quoted are what that preset actually solves to — checked by
 * learn/guides.test.ts, which plays each guide through.
 */

import { Guide, GuideContext } from './guide';

const flow = (c: GuideContext, tag: string) => c.read(tag)?.flowM3h ?? 0;
const running = (c: GuideContext, tag: string) => c.read(tag)?.running === true;

export const GUIDES: Guide[] = [
  {
    id: 'pump-switch',
    title: '펌프 A → B 전환',
    steps: [
      {
        tab: 'pfd',
        target: 'P-101A',
        text: 'PFD 탭에서 운전 중인 P-101A와 예비기 P-101B(정지)를 찾으세요. FI-101이 지금 루프 유량(약 92 m³/h)입니다.',
        done: (c) => c.viewMode === 'pfd',
      },
      {
        target: 'P-101B',
        text: 'P-101B를 선택하고 오른쪽 패널에서 "운전"을 켜 기동하세요.',
        done: (c) => running(c, 'P-101B') && flow(c, 'P-101B') > 10,
      },
      {
        tab: 'map',
        text: '맵 탭에서 물이 두 펌프로 나뉘어 흐르는 것을 보세요. 두 대가 함께 돌아도 총 유량은 약 7 %만 늘고, 각 펌프는 절반(BEP의 약 50 %)만 맡습니다 — 제어밸브가 조여 있어 시스템 곡선이 가파르기 때문입니다.',
        done: (c) => c.viewMode === 'map',
      },
      {
        tab: 'pfd',
        target: 'PI-101',
        text: 'PFD로 돌아와 FI-101과 PI-101을 읽으세요. 유량은 조금(약 99 m³/h), 펌프 토출 압력은 더 크게(약 4.7 → 5.2 bar g) 올랐습니다.',
        done: (c) => c.viewMode === 'pfd',
      },
      {
        target: 'P-101A',
        text: 'P-101A를 선택해 "운전"을 끄세요. 체크밸브가 역류를 막고, P-101B 혼자 유량을 이어받습니다.',
        done: (c) => !running(c, 'P-101A') && flow(c, 'P-101B') > 70,
      },
      {
        tab: 'map',
        text: '맵에서 확인하세요: 유량이 전환 전과 거의 같습니다(B 배관의 엘보 손실만큼 약간 적음). 전환 완료.',
        done: (c) => c.viewMode === 'map',
      },
    ],
  },
  {
    id: 'fcv-bypass',
    title: '제어밸브 조작과 바이패스',
    steps: [
      {
        tab: 'pfd',
        target: 'FCV-101',
        text: 'PFD 탭에서 FCV-101(위에 반원 액추에이터 = 제어밸브)과 그 위의 바이패스 HV-102(수동, 닫힘)를 찾으세요.',
        done: (c) => c.viewMode === 'pfd',
      },
      {
        target: 'FCV-101',
        text: 'FCV-101을 선택하고 개도를 30 % 이하로 줄이세요.',
        done: (c) => (c.read('FCV-101')?.openingPct ?? 100) <= 31,
      },
      {
        tab: 'map',
        text: '맵에서 유량이 크게 줄어든 것을 보세요(약 40 m³/h, BEP의 40 %). 펌프가 저유량 경고를 냅니다.',
        done: (c) => c.viewMode === 'map',
      },
      {
        tab: 'pfd',
        target: 'PI-101',
        text: 'PFD에서 PI-101을 읽으세요. 밸브를 조이면 유량이 줄고, 펌프는 곡선을 따라 더 높은 압력(약 5.3 bar g)을 냅니다.',
        done: (c) => c.viewMode === 'pfd',
      },
      {
        target: 'HV-102',
        text: 'HV-102를 선택해 50 %쯤 열어, 바이패스로 유량을 되살리세요.',
        done: (c) => (c.read('HV-102')?.openingPct ?? 0) >= 40 && (c.read('FI-101')?.value ?? 0) > 80,
      },
      {
        tab: 'map',
        text: '맵에서 물 대부분이 바이패스로 흐르는 것을 보세요(약 110 m³/h 중 80). FCV는 30 m³/h만 맡아 유량을 제어할 힘을 거의 잃습니다 — 바이패스는 정비·비상용입니다.',
        done: (c) => c.viewMode === 'map',
      },
    ],
  },
];
