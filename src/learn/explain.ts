/**
 * Warning explanations (PLAN-V2 §1.3): every analysis finding as three lines
 * — what is happening, why it is dangerous, what to change. Keyed on the
 * code clause analysis/report.ts folds into each message.
 */

export interface Explanation {
  what: string;
  why: string;
  fix: string;
}

const BY_CLAUSE: Array<[RegExp, Explanation | ((msg: string) => Explanation)]> = [
  [
    /ASME B31\.3/,
    {
      what: '배관 벽이 받는 원주응력이 허용응력에 가깝거나 넘었다.',
      why: '압력이 관벽 강도를 넘으면 관이 터지거나 찢어질 수 있다.',
      fix: '펌프 회전수를 낮추거나, 밸브를 천천히 닫아 압력 상승을 줄이거나, 두꺼운 스케줄(80)로 바꾼다.',
    },
  ],
  [
    /API RP 14E/,
    {
      what: '관 속 유속이 침식 한계 속도를 넘었다.',
      why: '빠른 물살이 관 안쪽을 깎아 내고 소음·진동을 만든다.',
      fix: '관경을 키우거나, 제어밸브를 조여 유량을 줄인다.',
    },
  ],
  [
    /ISA cavitation/,
    {
      what: '밸브를 지나며 압력이 증기압 근처까지 떨어진다(캐비테이션).',
      why: '생긴 기포가 하류에서 터지며 밸브 몸체와 트림을 때려 손상시킨다.',
      fix: '밸브를 더 열어 한 번에 떨어지는 차압을 줄이거나, 하류 압력을 높이거나, 바이패스로 나눠 흘린다.',
    },
  ],
  [
    /HI 9\.6\.3|API 610/,
    {
      what: '펌프가 거의 물을 내보내지 못하고 돌고 있다(체절 운전).',
      why: '들어간 동력이 빠져나가지 못한 물을 데워, 짧은 시간에 펌프가 과열·손상된다.',
      fix: '토출 쪽 밸브를 열어 최소 유량 이상을 흘리거나, 쓰지 않는 펌프는 정지한다.',
    },
  ],
  [
    /NPSH/,
    {
      what: '펌프 흡입 쪽 압력이 모자라 물이 끓듯 기포가 생긴다(NPSH 부족).',
      why: '임펠러가 기포 붕괴에 깎이고, 양정·유량이 떨어진다.',
      fix: '수조 수위를 높이거나, 스트레이너를 청소(막힘 해소)하거나, 유량을 줄인다.',
    },
  ],
  [
    /Hydraulic Institute/,
    (msg) => {
      const pct = Number(/(\d+)\s*% BEP/.exec(msg)?.[1] ?? NaN);
      return pct > 100
        ? {
            what: `펌프가 최고효율점(BEP)보다 훨씬 많은 유량(${pct}% BEP)으로 돈다.`,
            why: '모터가 과부하되고, 흡입 압력 여유(NPSH)가 줄어 캐비테이션 위험이 커진다.',
            fix: '제어밸브(FCV)를 조여 유량을 BEP의 70–120% 안으로 줄인다.',
          }
        : {
            what: `펌프가 최고효율점(BEP)보다 훨씬 적은 유량${Number.isFinite(pct) ? `(${pct}% BEP)` : ''}으로 돈다.`,
            why: '임펠러 입구에서 재순환이 생겨 진동·소음·베어링 마모가 늘어난다.',
            fix: '밸브를 열거나 바이패스를 열어 유량을 BEP의 70–120% 안으로 늘린다.',
          };
    },
  ],
];

const FALLBACK = (msg: string): Explanation => ({
  what: msg,
  why: '이 상태로는 해석 결과가 계통 전체를 나타내지 못한다.',
  fix: '표시된 요소를 눌러 연결과 설정을 확인한다.',
});

export function explain(message: string): Explanation {
  for (const [re, e] of BY_CLAUSE) if (re.test(message)) return typeof e === 'function' ? e(message) : e;
  return FALLBACK(message);
}
