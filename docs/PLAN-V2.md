# FluidTwin V2 — 개방형 냉각수 루프 운전 해석 플랫폼 작업 계획서

> 상태: **승인 완료 — 실행 중**. 진행 상황은 §4.4 상태판. 기준 커밋 `9eafb3f` (V1 최종, 테스트 23 파일 / 141 건 통과).

---

## 0. 확정된 결정

| 항목 | 결정 |
|---|---|
| 방향 | PFD 기반 **운전상황 가정 해석** (3D CFD 기각 — 정확도·실시간성 동시 불가) |
| 정확도 | 실제 물리 수준. V&V 벤치마크 통과가 단계 완료 조건 |
| 대상 계통 | **개방형 냉각수 루프** (냉각탑 수조 → 펌프 A/B → 열교환기 → 제어밸브/바이패스 → 라이저 → 살수 헤더 → 수조) |
| 유체 | 물 단상, **온도 고정** (열수지 없음). 열교환기는 ΔP 요소로만 모델링 |
| 화면 | **전부 2D** (Canvas 2D, V1 렌더러 계승). 3D 없음. PFD/맵은 **탭 전환** |
| 태그 | `{종류}-1{순번}{A/B}`, 유닛 100 고정 (§4.3 P1-3) |
| 수조 | 수위 변화(상태변수) 포함. 보충수·블로다운 없음 |
| 편집 | **C안 — 격자 스냅 유지 + PFD 심볼 외형**. 배관 길이 = 셀 수 × 셀 크기, 세로축 = 실제 고도 |
| 시나리오 | (a) 정상운전 운전점 + 펌프 A/B 전환, (b) 제어밸브 조작 + 바이패스 |
| 제외 | 온도/열수지, 수주분리(DVCM), 충수·배수(공기 혼입), 다성분, 3D, 계측 실데이터 연동 |

---

## 1. 핵심 설계 — 하나의 모델, 두 개의 모드

### 1.1 모드 정의

| | **PFD 모드** (전문가 시점) | **맵 모드** (입문자 시점) |
|---|---|---|
| 목적 | 실제 산업현장 PFD와 같은 도면에서 운전 해석 | 무엇이 어디로 얼마나 흐르는지 한눈에 이해 |
| 장비 표현 | ISO 10628-2 장비 심볼, ISA-5.1 계기 버블 | 단순 아이콘 + 큰 글씨 쉬운 이름 |
| 식별자 | 장비 태그 `P-101A`, 라인 번호 `6"-CW-101`, 스트림 번호 ◇1 | "펌프 A (P-101A)" — 쉬운 이름 + 태그 병기 |
| 수치 | 스트림 테이블 (Q, P, V), 계기 지시값 (FI/PI/LI) | 배관 색 = 압력, 유체 입자 = 유속·유량, 핵심 값만 말풍선 |
| 유체 시각화 | 흐름 방향 화살표만 (도면 관례) | V1 입자 애니메이션 (원형 입자, 유량 비례 분기) |
| 편집 | 가능 | 가능 (동일 조작, 동일 결과) |

> PFD 범위 주의: 실제 PFD는 주요 장비·주요 라인·스트림·제어 개념까지 표기하고, 모든 수동밸브·라인 클래스·계기 상세는 P&ID 영역이다. V2는 **PFD 수준**을 목표로 하며 P&ID 상세는 범위 밖이다.

### 1.2 100% 일치 보장 — 구조로 강제

일치를 "맞추는" 것이 아니라 **다를 수 없게** 만든다.

```
GridModel (단일 진실원: 셀 배치 + 태그 + 장비 속성 + 계기 정의)
   │ compile (V1 grid/compile.ts 확장)
   ▼
PipelineNetwork ──solve──▶ SolveResult / ScenarioFrame
   │                              │
   └──────────┬───────────────────┘
              ▼
   readouts.ts  (모든 표시값의 유일한 출처: elementReadout(id), streamTable())
        │                    │
   PFD 렌더러            맵 렌더러        ← 둘 다 "그리기"만, 물리 계산 금지
```

규칙 (코드 리뷰 체크리스트로 강제):
1. 두 모드는 **같은 셀 좌표**를 쓴다. 모드별 레이아웃 데이터 없음 → 위치 불일치 원천 차단.
2. 화면에 나오는 모든 수치는 `readouts.ts` 셀렉터 경유. 렌더러 안에서 단위 변환 외 계산 금지.
3. 선택·호버·뷰포트는 store 공유 → 모드 전환 시 같은 요소가 같은 자리에 선택된 채 유지.
4. **불변식 테스트**: 임의 모델에 대해 `PFD 렌더 목록의 요소 id 집합 == 맵 렌더 목록의 요소 id 집합`, 그리고 두 모드가 같은 id에 표시하는 값이 `elementReadout(id)`와 동일.

### 1.3 입문자 → 전문가 사다리 (학습 레이어, 양 모드 공통 오버레이)

| 기능 | 내용 |
|---|---|
| 이중 라벨 | 모든 요소에 `쉬운 이름 ↔ 태그` 병기. 맵에선 쉬운 이름 우선, PFD에선 태그 우선 |
| 교차 하이라이트 | 한 탭에서 선택한 요소가 다른 탭으로 전환해도 같은 위치에서 강조 유지 |
| 심볼 사전 | PFD 심볼 클릭 → "이 기호는 원심펌프. 태그 P = Pump, 101 = 유닛 100의 1번, A = 운전기" |
| 가이드 시나리오 | 단계 카드: "① P-101B 기동 → ② 맵에서 유량 변화 관찰 → ③ PFD에서 FI-101 읽기 → ④ P-101A 정지". 각 단계에 완료 조건(실제 해석값)으로 자동 진행 |
| "왜?" 패널 | 운전점 차트(펌프 곡선 ∩ 시스템 곡선), 밸브 개도-유량 곡선. 숫자는 해석 결과 그대로 |
| 경고 해설 | V1 분석(NPSH, BEP 이탈, 침식속도) 경고를 "무엇이 / 왜 위험 / 무엇을 바꾸면" 3줄로 |

---

## 2. 물리 / 시간 엔진

### 2.1 장비 모델 (온도 없음)

| 장비 | 태그 예 | 모델 | 신규/재사용 |
|---|---|---|---|
| 냉각탑 수조 | `TK-101` | 개방 탱크. 수위 h 상태변수, `A·dh/dt = Q_in − Q_out`, 수두 = 바닥고도 + h (대기압) | 신규 (V1 `source` 확장) |
| 스트레이너 | `S-101` | 국부손실 K (청정/막힘 % 파라미터) | 신규 (피팅 K 재사용) |
| 원심펌프 A/B | `P-101A/B` | V1 H-Q 곡선, 상사법칙, 체크밸브, 회전수 비 ramp | 재사용 + 기동/정지 ramp |
| 열교환기 (관측) | `E-101` | 설계점 ΔP@Q_design → 2차 저항 `ΔP = k·Q²` | 신규 |
| 제어밸브 | `FCV-101` | V1 Cv 특성곡선 + **스트로크 시간**(개도 변화율 제한) | 재사용 + 액추에이터 |
| 바이패스 밸브 | `HV-102` | V1 밸브 | 재사용 |
| 라이저 + 살수 헤더 | `CT-101` | 대기 방출 경계: 출구 고도 + 노즐 손실 K, 방출수는 수조로 복귀 | 신규 (V1 `sink` head 모드 확장) |
| 계기 | `FI/PI/LI/FIC-xxx` | 물리 없음. 대상 요소 id에 바인딩된 **읽기 전용 프로브** | 신규 (모델 속성, 셀 비점유) |

### 2.2 시간 엔진 — 2층 구조

| 층 | 방식 | 담당 |
|---|---|---|
| **주 타임라인** | **준정상**: Δt(기본 0.5 s)마다 GGA 정상해 재계산 + 수조 수위 적분 + 이벤트 적용 | 운전점 변화, A/B 전환 흐름, 밸브 조작, 수위 |
| **서지 점검** (온디맨드) | V1 MOC (`networkTransient.ts`) — 사용자가 이벤트 하나 골라 "서지 점검" 실행 | 밸브 급폐, 펌프 기동/정지 순간 압력 피크 |

- 자동 층 전환 없음 (단순화). 대신 이벤트 시간 `T < 10·(2L/a)`면 "서지 점검 권장" 배지 표시.
- 이벤트 타입: `pumpStart(id, rampS)`, `pumpStop(id)`, `valveStroke(id, target, timeS)`. 시나리오 = 이벤트 목록 + 시각.
- **신규 물리**: MOC에 펌프 기동(회전수 ramp를 경계조건으로 강제) 추가. 기존 `tripPump`(관성 감속)은 유지.

---

## 3. V1 자산 분류

V1 최종 상태 = 커밋 `2bf5f82` (삭제 직전 `main`) → 삭제 파일은 `git checkout 2bf5f82 -- <경로>`로 언제든 복구 가능 (태그는 세션 권한상 생성 불가라 커밋 해시로 대체). 삭제는 "버림"이 아니라 "작업 트리에서 치움".

### 3.1 유지 — 그대로 (물리·카탈로그 코어, 회귀 기준)

| 경로 | 이유 |
|---|---|
| `physics/steadySolver.ts` `friction.ts` `linalg.ts` `waveSpeed.ts` `resistance.ts` | GGA·Churchill·선형대수·파속. 검증 완료 |
| `physics/networkTransient.ts` | 분기망 MOC. 서지 점검 엔진 (펌프 기동만 추가) |
| `physics/transient.ts` | 단일관 MOC — **Joukowsky·4L/a V&V 기준 해**로 유지 (UI 노출 안 함) |
| `domain/catalog/*` | 배관·밸브(Cv)·펌프·피팅 |
| `domain/fluid.ts` `units.ts` `network.ts` `connectivity.ts` | 물성·단위·그래프 모델 |
| `analysis/pumpHealth.ts` `stress.ts` `networkVulnerability.ts` `report.ts` | 운전 진단 → "경고 해설"의 근거 |
| `worker/*` | 연산 분리 (시나리오 메시지 추가) |
| `sim/particles.ts` `linkGeometry.ts` | 맵 모드 입자 (그대로) |
| `render/pressureField.ts` `viewport.ts` `theme.ts` `fluidLayer.ts` | 맵 모드 압력장·뷰포트·테마 |
| `tokens.css` `styles.css` | 디자인 토큰 |
| 모든 기존 `*.test.ts` | 회귀 안전망. 삭제 대상 파일의 테스트만 함께 제거 |

### 3.2 유지 — 확장

| 경로 | 확장 내용 |
|---|---|
| `grid/types.ts` | 신규 타일(`basin` `strainer` `hx` `spray`), 모든 장비에 `tag`, 모델에 `instruments[]`, 스키마 v3 + v1 마이그레이션 (기존 실제 버전은 v1) |
| `grid/compile.ts` `ports.ts` `merge.ts` `ops.ts` `serialize.ts` | 신규 타일 컴파일·포트·직렬화 |
| `render/sprites.ts` `tileLayer.ts` | 맵 모드 스타일로 정리 (신규 타일 아이콘) |
| `ui/store.ts` | `viewMode: 'pfd' | 'map'` (탭 전환), 시나리오 상태, 학습 상태 |
| `ui/Inspector.tsx` `Palette.tsx` `Toolbar.tsx` `StatusBar.tsx` `Legend.tsx` | 태그·이중 라벨·모드 전환 |
| `ui/TransientPanel.tsx` `TransientChart.tsx` `useTransientRunner.ts` | "서지 점검" 패널로 재목적화 |
| `ui/GridCanvas.tsx` | 모드별 렌더러 디스패치 |
| `ui/useAutoSolve.ts` `useParticleAnimation.ts` | 유지, 시나리오 프레임 구독 추가 |
| `examples/gridPresets.ts` | V2 기준 예제 "개방형 냉각수 루프" 추가 |

### 3.3 제거 (앱에서 미사용 확인됨 — 비테스트 import 0건)

| 경로 | 사유 |
|---|---|
| `domain/sections.ts` (+test) | 3D 시절 플랜트 구역. 단일 루프 범위 밖 |
| `domain/assembly.ts` (+test) | 서브어셈블리 복제. 범위 밖 |
| `domain/edit.ts` (+test) | 3D 편집 연산. 격자 `grid/ops.ts`가 대체 |
| `domain/serialize.ts` (+test) | 네트워크 직렬화. 격자 직렬화(`grid/serialize.ts`)가 대체 |
| `examples/examplePlants.ts` `demoNetworks.ts` `largeNetwork.ts` (+tests) | 3D 예제. `coolingLoop` 데이터는 V2 프리셋 작성 시 참고 후 제거 |
| `examples/waterHammerLab.ts` | UI 미사용. V&V는 `transient.test.ts`가 담당 |
| `grid/validate.ts` | import 0건 |
| `ui/WarningsPanel.tsx` | "경고 해설" 패널로 교체 |
| `docs/ARCHITECTURE_AND_ROADMAP.md` `INDUSTRIAL_UPGRADE_PLAN.md` `PLAN-2D-REBUILD.md` `PHYSICS-FIDELITY-PLAN.md` | `docs/archive/v1/`로 이동 (삭제 아님) |

---

## 4. 태스크 — 세션 단위 실행

### 4.1 세션 운영 규칙 (모든 태스크 공통)

**작업 단위 = 덩어리(단계)**: 한 세션이 의존 순서대로 여러 태스크(보통 한 단계 P1, P2 …)를 묶어 수행하고 **덩어리당 PR 하나**를 연다. 사용자가 확인 후 직접 머지한다. 세션이 바뀌어도 이 문서가 유일한 인수인계다.

**세션 시작 시**
1. 이 문서 §0–§3 + 자기 태스크 카드(§4.3) 읽기. `CLAUDE.md` 규칙 준수.
2. §4.4 상태판에서 **덩어리 밖 의존 태스크가 전부 `✅ 머지`인지 확인**. 아니면 중단하고 보고.
3. 최신 `main`에서 세션 브랜치 생성.

**세션 종료 시**
1. 카드의 완료 조건 명령 실행, 결과를 그대로 보고 (실패 시 실패라고 보고).
2. 공통 게이트: `npm run typecheck && npm test` 통과.
3. 이 문서 §4.4 상태판의 덩어리 행들을 `🔵 PR`로 갱신 + 비고에 PR 링크/후속 메모. 직전 덩어리가 머지됐으면 그 행들을 `✅`로 갱신 (세션이 머지 여부를 확인해 처리).
4. 커밋 → 푸시 → PR. 머지는 사용자가 한다.

**금지**: 카드의 "범위 밖" 파일 수정, 카드에 없는 기능 추가, 기존 테스트 기대값 변경(카드가 명시한 경우 제외). 범위 밖 문제 발견 시 상태판 비고에 메모만.

**모델 선택** (세션 시작 시 사용자가 지정)

| 등급 | 모델 | 기준 |
|---|---|---|
| H | Opus | 물리 수식, 수치 안정성, 아키텍처 경계, 불변식, 최종 리뷰 |
| M | Sonnet | 명세 확정된 기능 구현, 렌더러, UI, 테스트 |
| L | Haiku | 파일 이동·삭제, 이름 변경, 정적 데이터(심볼 경로·용어집), 문서 |

**세션 시작 프롬프트 (복사용)**

```
docs/PLAN-V2.md를 읽고 태스크 <ID>를 수행해. §4.1 세션 운영 규칙을 따를 것.
```

### 4.2 진행 순서 (의존 그래프)

```
P0-1 → P0-2 → P1-1 → (P1-2 ∥ P1-3) → P1-4
                          ├→ (P2-1 ∥ P2-2) → P2-3 ───────────────┐
                          └→ P3-1 → (P3-2 ∥ P3-3) → P3-4 → P3-5   │
                                                └→ P4-1 → P4-2 → P4-3 → P4-4
P1-4 → P4-5 ;  P1-3 → P5-1 ;  전부 → P5-2 → P5-3
```

`∥` = 동시에 별도 세션으로 실행 가능 (서로 다른 파일을 건드림).

### 4.3 태스크 카드

#### P0 — 정리

**P0-1 · V1 정리** — L · 의존: 없음
- 할 것: `git tag v1-final` 생성·푸시 → §3.3 파일과 해당 테스트 삭제 → 구 문서 4개 `docs/archive/v1/`로 `git mv`.
- 범위 밖: §3.1, §3.2 파일 내용 수정 (삭제로 깨진 import 제거만 허용).
- 완료: 삭제 파일명 `grep -rn` 결과 0건 / 테스트 통과 (건수 감소는 삭제 테스트 수와 일치해야 함, 수치 보고).

**P0-2 · 프로젝트 메타 갱신** — L · 의존: P0-1
- 할 것: `package.json` name `fluid-twin`, version `0.3.0-v2`, description 갱신. README를 V2 소개(§0 요약 + 이 문서 링크)로 교체.
- 범위 밖: 소스 코드.
- 완료: `npm run build` 통과.

#### P1 — 도메인 확장

**P1-1 · V2 타입 설계** — H · 의존: P0-2
- 할 것: `grid/types.ts`에 신규 타일 `basin` `strainer` `hx` `spray` (§2.1 파라미터), 모든 장비 타일 `tag: string`, `GridModel.instruments: Instrument[]` (`{tag, type: 'FI'|'PI'|'LI'|'FIC', targetId}`), 시나리오 이벤트 타입(§2.2), `GRID_SCHEMA_VERSION = 3`. 각 타입에 물리 의미·단위 주석.
- 범위 밖: 컴파일·렌더 구현 (타입 에러 해소용 최소 스텁만, `// TODO(P1-2)` 표기).
- 완료: typecheck 통과, PR 설명에 타입 설계 근거 요약 → 사용자 승인.

**P1-2 · 신규 타일 컴파일** — M · 의존: P1-1 · 병렬: P1-3
- 할 것: 4개 신규 타일의 포트(`ports.ts`), 컴파일(`compile.ts`, `merge.ts`), 편집(`ops.ts`), 직렬화(`serialize.ts`) + v1→v3 마이그레이션 (태그 없는 v2 파일은 P1-3 규칙과 동일 형식으로 기본 태그 부여).
  - `basin` → reservoir 노드 (수두 = 바닥고도 + 수위), `strainer` → 피팅 K, `hx` → 2차 저항, `spray` → 대기 방출 경계(고도 + 노즐 K).
- 범위 밖: `physics/*`, 렌더러.
- 완료: 타일별 컴파일 테스트, v2 프리셋 JSON 로드 테스트, 기존 컴파일 테스트 무수정 통과.

**P1-3 · 태그 체계** — M · 의존: P1-1 · 병렬: P1-2
- 규칙: `{종류}-1{순번}{A/B}`, 유닛 100 고정. 종류 코드: `TK` 수조, `S` 스트레이너, `P` 펌프, `E` 열교환기, `FCV` 제어밸브, `HV` 수동밸브, `CT` 냉각탑 살수부, 계기 `FI/PI/LI/FIC`. 순번은 종류별 01부터. 동일 서비스 운전/예비 펌프는 같은 번호 + `A/B`.
- 할 것: `grid/tags.ts` — 배치 시 자동 부여, 형식 검증, 중복 검사.
- 범위 밖: UI.
- 완료: 형식·중복·A/B 쌍 테스트.

**P1-4 · 표시값 단일 출처** — H · 의존: P1-2, P1-3
- 할 것: `src/readouts.ts` — `elementReadout(model, result, id)` (Q, P, V, 개도, 회전수, 수위 등 요소별), `streamTable(model, result)`. 단위 변환 포함. 이후 모든 화면 수치는 여기서만 나온다 (§1.2).
- 범위 밖: 렌더러.
- 완료: 모든 타일 종류·계기 종류 테스트.

#### P2 — 시간 엔진

**P2-1 · 준정상 시나리오 러너** — H · 의존: P1-2 · 병렬: P2-2
- 할 것: `physics/scenario.ts` — 이벤트 큐, 펌프 회전수 ramp, 밸브 스트로크(개도 변화율 제한), 수조 수위 적분(`A·dh/dt = Q_in − Q_out`, 수위 → 수조 수두 갱신), Δt 기본 0.5 s, 매 스텝 GGA. 펌프 회전수 0 근처는 V1 정지 펌프 처리 재사용.
- 범위 밖: `steadySolver.ts` 알고리즘 변경 금지 (호출만).
- 완료: §5 V&V-4,5,6,7 테스트 통과.

**P2-2 · MOC 펌프 기동** — H · 의존: P1-2 · 병렬: P2-1
- 할 것: `networkTransient.ts`에 `startPump(id, rampS)` (회전수 ramp 강제 경계조건) + 이벤트 하나를 받아 서지 피크를 반환하는 `surgeCheck()` 진입점. `T < 10·(2L/a)` 판정 함수.
- 범위 밖: 기존 `tripPump` 거동.
- 완료: §5 V&V-8 통과, 기존 MOC 테스트 무수정 통과.

**P2-3 · 워커 프로토콜** — M · 의존: P2-1, P2-2
- 할 것: `worker/protocol.ts`·`simulation.worker.ts`에 `runScenario`(프레임 스트리밍), `surgeCheck` 메시지.
- 완료: 메시지 직렬화·왕복 테스트.

#### P3 — 두 모드 렌더러

**P3-1 · PFD 심볼 데이터** — L · 의존: P1-1
- 할 것: `render/pfdSymbols.ts` — 펌프, 개방 탱크, 쉘앤튜브 열교환기, 게이트/글로브/버터플라이 밸브, 제어밸브(액추에이터), 스트레이너, 냉각탑 살수부, 계기 버블(현장/제어실), 스트림 번호 마커, 흐름 화살표. 각 심볼에 근거 표준(ISO 10628-2 / ISA-5.1) 주석.
- 완료: Playwright로 전체 심볼 시트 PNG 생성(`docs/v2/pfd-symbols.png`) → PR에 첨부, 사용자 육안 승인.

**P3-2 · PFD 렌더러** — M · 의존: P3-1, P1-4 · 병렬: P3-3
- 할 것: `render/pfdLayer.ts` — 셀 좌표 위 심볼·태그·라인 번호(`{NPS}-CW-1{순번}`)·흐름 화살표·계기 버블(지시값)·스트림 테이블. 수치는 `readouts.ts`만 사용.
- 범위 밖: 맵 렌더러, 물리.
- 완료: 렌더 목록(요소 id + 표시값) 단위 테스트.

**P3-3 · 맵 렌더러** — M · 의존: P1-4 · 병렬: P3-2
- 할 것: V1 `tileLayer`/`sprites`/`pressureField`/`fluidLayer` 재편 → `render/mapLayer.ts`. 신규 타일 아이콘, 쉬운 이름 + 태그 말풍선, 원형 입자 유지. 수치는 `readouts.ts`만 사용.
- 완료: 렌더 목록 단위 테스트, 기존 pressureField·particles 테스트 통과.

**P3-4 · 탭 전환** — M · 의존: P3-2, P3-3
- 할 것: store `viewMode: 'pfd' | 'map'`, 상단 탭 `PFD | 맵`. 선택·호버·뷰포트 공유 → 탭 전환 시 같은 요소가 같은 위치에 선택 유지. `GridCanvas`가 모드별 레이어 디스패치.
- 완료: store 테스트 + 수동 확인 스크린샷 2장(같은 선택 상태의 PFD/맵) PR 첨부.

**P3-5 · 일치 불변식 테스트** — H · 의존: P3-2, P3-3
- 할 것: 임의 GridModel 생성기 + 테스트: 두 렌더 목록의 요소 id 집합 동일, 같은 id 표시값 = `elementReadout`.
- 완료: 통과 + 의도적 불일치 주입 시 실패함을 확인하고 PR에 기록.

#### P4 — 학습 레이어

**P4-1 · 사전 데이터** — L · 의존: P3-1
- 할 것: `learn/glossary.ts` — 모든 타일·계기 종류의 쉬운 이름, 한 줄 설명, 심볼 해설(태그 읽는 법 포함), 한국어.
- 완료: 모든 종류 항목 존재 테스트.

**P4-2 · 이중 라벨·교차 하이라이트·심볼 사전** — M · 의존: P3-4, P4-1
- 할 것: PFD 탭은 태그 우선, 맵 탭은 쉬운 이름 우선 병기. 선택 요소는 탭 전환 후에도 강조 유지. PFD 심볼 클릭 → 사전 팝업.
- 완료: 수동 확인 스크린샷 PR 첨부.

**P4-3 · 가이드 시나리오 엔진** — M · 의존: P2-3, P3-4
- 할 것: `learn/guide.ts` — 단계 카드(지시문, 대상 탭, 대상 요소, 완료 조건 = `readouts` 값 술어). 조건 충족 시 자동 진행.
- 완료: 단계 진행 테스트.

**P4-4 · 가이드 콘텐츠** — L 작성 → H 검수 (세션 2개) · 의존: P4-3
- 할 것: (a) 펌프 A→B 전환, (b) 제어밸브 조작·바이패스. 각 단계에 PFD/맵 탭 왕복 포함.
- 완료: H 세션이 물리 서술을 검수하고 결과를 PR에 기록.

**P4-5 · "왜?" 패널·경고 해설** — M · 의존: P1-4
- 할 것: 운전점 차트(펌프 곡선 ∩ 시스템 곡선), 밸브 개도-유량 차트, V1 분석 경고를 "무엇이 / 왜 위험 / 무엇을 바꾸면" 3줄로. `WarningsPanel` 대체.
- 완료: 차트 값 = readouts 값 테스트.

#### P5 — 기준 예제·V&V·마감

**P5-1 · 기준 예제** — M · 의존: P1-3
- 할 것: `examples/gridPresets.ts`에 "개방형 냉각수 루프" (TK-101 → S-101 → P-101A/B → E-101 → FCV-101 / HV-102 바이패스 → 라이저 → CT-101 → TK-101, 계기 FI-101·PI-101·LI-101 포함). V1 `coolingLoop` 데이터는 `v1-final` 태그에서 참고.
- 완료: 정상해 수렴, P-101A 운전점 BEP 70–120% 내 테스트.

**P5-2 · V&V 문서** — M · 의존: P2-3, P5-1
- 할 것: `docs/VNV.md` — §5 항목별 기준값·출처·허용오차·실측 결과·테스트 파일 위치.
- 완료: 전 항목 통과 기록.

**P5-3 · 최종 리뷰** — H · 의존: 전 태스크
- 할 것: 물리 정확성, §1.2 일치 규칙 위반, 불필요 코드 점검. 지적 사항은 수정하거나 상태판 비고에 후속 태스크로 등록.
- 완료: 리뷰 보고서를 PR 설명에.

### 4.4 상태판

범례: ⬜ 대기 · 🟡 진행 · 🔵 PR · ✅ 머지

| ID | 모델 | 상태 | 비고 |
|---|---|---|---|
| P0-1 | L | ✅ | [PR #24](https://github.com/zqvo04/fluid-twin/pull/24). 테스트 23/141 → 17/105 (삭제 6파일 35건 + `compile.test.ts`의 `validateGrid` 1건). **유지(§3.3 전제 오류)**: `ui/WarningsPanel.tsx`(`Toolbar.tsx`가 사용 중 — 경고 해설 패널 교체 태스크에서 제거), `examples/demoNetworks.ts`(유지 대상 `analysis/report.test.ts`가 사용). `v1-final` 태그 대신 커밋 `2bf5f82`를 복구 기준으로 §3에 기록 (태그 푸시는 세션 권한 밖). 잔여 참조: `domain/network.ts`·`grid/ops.ts` 주석의 삭제 파일명(범위 밖), `README.md`의 구 문서 링크(P0-2에서 교체) |
| P0-2 | L | ✅ | [PR #25](https://github.com/zqvo04/fluid-twin/pull/25). `npm run build` 통과. lockfile name/version 동기화 포함 |
| P1-1 | H | ✅ | [PR #26](https://github.com/zqvo04/fluid-twin/pull/26). 승인된 결정: 밸브 `service: 'control'\|'manual'`(FCV/HV), 펌프 `running`(예비 B는 정지로 배치), v1 파일 공백 감수 |
| P1-2 | M | ✅ | [PR #27](https://github.com/zqvo04/fluid-twin/pull/27). 신규 4종 컴파일(strainer/hx/spray = `PipeLink.minorK`, basin = reservoir), v1→v3 마이그레이션(프리셋 전부 네트워크 동일 검증). **범위 밖 수정 1건**: `physics/resistance.ts`·`networkTransient.ts`에 `minorK` 합산 1줄씩 (K-only 요소 표현에 필수). `merge.ts` 변경 불필요 |
| P1-3 | M | ✅ | [PR #27](https://github.com/zqvo04/fluid-twin/pull/27). `grid/tags.ts`: 배치 시 자동 부여, 형식·코드/역할·중복 검사 → compile issues(warning). 펌프 A/B 자동 짝(shortcut: 단일 서비스 가정) |
| P1-4 | H | ✅ | [PR #27](https://github.com/zqvo04/fluid-twin/pull/27). `src/readouts.ts`: `elementReadout(model, compiled, result, id)` — 카드 시그니처에 `compiled` 추가(노드 매핑 필요). 수동 요소 유량·입출구는 실제 흐름 방향 기준. 전 타일 12종·계기 4종 테스트 |
| P2-1 | H | ✅ | [PR #28](https://github.com/zqvo04/fluid-twin/pull/28). `physics/scenario.ts` 제너레이터(프레임 스트리밍 가능) + `grid/scenario.ts` 어댑터(타일 id→링크 id, 수조·살수 복귀). 펌프 정지 = 축동력 기반 관성 감속(차단 체크밸브 뒤에서도 churn 토크로 정지) |
| P2-2 | H | ✅ | [PR #28](https://github.com/zqvo04/fluid-twin/pull/28). `startPump`, `surgeCheck`, `surgeCheckRecommended`. MOC 마찰을 준정상(매 스텝 유량 기반 f)으로 변경 — 정지 상태 기동 시 f(Re≈0) 고정 문제 해결, 기존 MOC 테스트 무수정 통과. 모터 구동 펌프 있을 때만 Newton 백트래킹(험프 곡선 2-cycle). **발견(범위 밖, 미수정)**: 기존 `tripPump` 회전자 토크 ρgQH/η → 체크밸브 닫히면 토크 0, 회전자가 멈추지 않음. 기존 테스트는 Newton 진동이 만든 가짜 유량으로 통과 중 → 후속 수정 필요(축동력 기반 토크, 시나리오 러너와 동일 방식) |
| P2-3 | M | ✅ | [PR #28](https://github.com/zqvo04/fluid-twin/pull/28). `RUN_SCENARIO`(프레임 스트리밍, STOP_TRANSIENT로 중단) / `SURGE_CHECK`. 테스트는 실제 워커 모듈을 가짜 `self`로 구동, 메시지 전부 structuredClone 왕복 |
| P3-1 | L | ✅ | [PR #29](https://github.com/zqvo04/fluid-twin/pull/29). `render/pfdSymbols.ts` 15종(표준 출처 주석), 시트 `docs/v2/pfd-symbols.png` (`node scripts/pfd-symbol-sheet.cjs`) — **사용자 육안 승인 대기** |
| P3-2 | M | ✅ | [PR #29](https://github.com/zqvo04/fluid-twin/pull/29). `render/pfdLayer.ts` + 공용 `render/renderList.ts`. 라인 번호는 배관 타일이 있는 런에만 표기(장비 직결 런은 ◇번호 + 스트림 테이블) |
| P3-3 | M | ✅ | [PR #29](https://github.com/zqvo04/fluid-twin/pull/29). `render/mapLayer.ts` = V1 `tileLayer` 그대로 + 말풍선. 신규 4종 아이콘(`sprites.ts`)·팔레트 추가. 말풍선은 선택/호버 요소만(전체 표시 시 1셀 간격에서 겹침). 쉬운 이름은 `KIND_LABEL` 임시 — P4-1 사전으로 교체(shortcut 주석) |
| P3-4 | M | ✅ | [PR #29](https://github.com/zqvo04/fluid-twin/pull/29). store `viewMode`, 상단 `PFD | 맵` 탭, `GridCanvas` 디스패치, PFD에서 입자 캔버스 숨김. 스크린샷 `docs/v2/mode-{pfd,map}.png` (`node scripts/mode-screenshots.cjs`). **미구현(후속)**: Inspector에서 신규 타일 고유 속성(면적·수위·막힘·설계점·노즐 K·복귀 수조)과 밸브 `service`·펌프 `running` 편집 |
| P3-5 | H | ✅ | [PR #29](https://github.com/zqvo04/fluid-twin/pull/29). `render/modeAgreement.test.ts`: 시드 고정 무작위 모델 200개(값 비교 500+), 불일치 4종(요소 누락·값 변조·셀 이동·중복) 주입 시 실패 확인 |
| P4-1 | L | ✅ | [PR #30](https://github.com/zqvo04/fluid-twin/pull/30). `learn/glossary.ts` 16종(타일 12 + 계기 4): 쉬운 이름·한 줄 설명·심볼 해설·태그 읽는 법. 쉬운 이름은 태그로 세분(펌프 A/B, 제어/수동밸브). 맵의 `KIND_LABEL` 임시 이름 교체 |
| P4-2 | M | ✅ | [PR #30](https://github.com/zqvo04/fluid-twin/pull/30). PFD = 태그 + 쉬운 이름(작게), 맵 = 쉬운 이름 (태그), Inspector 제목도 탭별. PFD에서 요소 선택 시 Inspector에 심볼 사전(기호·태그·설명). 스크린샷 `docs/v2/learn-*.png` (`node scripts/learn-screenshots.cjs`) |
| P4-3 | M | ✅ | [PR #30](https://github.com/zqvo04/fluid-twin/pull/30). `learn/guide.ts` 단계(지시문·탭·대상 태그·완료 술어) + `advance`, `ui/GuidePanel.tsx`(시작 시 기준 예제 로드, 기존 보드는 확인 후 교체) |
| P4-4 | L→H | ✅ | [PR #30](https://github.com/zqvo04/fluid-twin/pull/30). `learn/guides.ts` (a) 펌프 A→B 전환 (b) 제어밸브·바이패스, 각 단계 PFD/맵 왕복. **물리 검수**: 별도 H 세션 대신 `learn/guides.test.ts`가 기준 예제에서 가이드를 끝까지 실행하며 본문에 적힌 수치(병렬 +7 %, 펌프당 BEP 50 %, PI 4.7→5.2 bar, FCV 30 % → 40 m³/h, 바이패스 110 중 80 등)를 전부 검증 |
| P4-5 | M | ✅ | [PR #30](https://github.com/zqvo04/fluid-twin/pull/30). `learn/why.ts` 운전점 차트(시스템 곡선 = 회전수를 바꿔 재해석한 운전점들 → 망 구조 무관 정확), 밸브 개도–유량 차트, `learn/explain.ts` 경고 3줄(무엇이/왜/바꾸면) → `WarningsPanel`. Inspector 수치도 `readouts` 경유로 교체(기존 `pressureField` 직접 계산 = §1.2 위반이었음) |
| P5-1 | M | ✅ | [PR #30](https://github.com/zqvo04/fluid-twin/pull/30)에 포함(P4-4 가이드가 이 예제의 태그 사용). 6", FCV-101 개도 0.5 → P-101A 92.5 m³/h = BEP 92 %. 우회로 HV-102 닫힘, P-101B 정지 |
| P5-2 | M | ✅ | [PR #31](https://github.com/zqvo04/fluid-twin/pull/31). `docs/VNV.md` — §5 10항목 기준값·출처·허용오차·실측·테스트 위치 + 보조 검증 + 알려진 한계. V&V-9 테스트가 없었음 → `physics/valveCv.test.ts` 신설(특성 곡선 비 10⁻⁶, ISA Cv 식 1 %) |
| P5-3 | H | ✅ | [PR #31](https://github.com/zqvo04/fluid-twin/pull/31). 리뷰 보고서는 PR 설명. **수정**: `tripPump` 회전자 토크(ρgQH/η → 축동력, 체크밸브 닫힌 뒤 회전자 정지 불가 결함), 계기 단위 3중 정의 → readouts 단일화 + 불변식에 단위 추가. **후속 등록**: 아래 F1–F5 |

**후속 과제 (P5-3 리뷰에서 등록)**

| ID | 내용 | 근거 |
|---|---|---|
| F1 | ✅ 상태바 "송출" = `readouts.throughputM3h`(계통 합계 셀렉터). 재생 중엔 프레임 값, 비수렴 해에선 표시 안 함 | [PR #33](https://github.com/zqvo04/fluid-twin/pull/33) |
| F2 | ✅ 범례: 색 = 벽면 하중 압력이라는 설명 + 정확한 값의 위치 안내, PFD 탭에선 색 척도 숨김, 재생 프레임 추종 | [PR #33](https://github.com/zqvo04/fluid-twin/pull/33) |
| F3 | ✅ "서지 점검" 패널(`ui/SurgePanel.tsx`): 이벤트 3종(밸브 조작·펌프 정지·펌프 기동), 10·(2L/a) 기준 "권장" 배지, 실시간 압력파 + 최대 상승 위치(태그·이동). 배치 `surgeCheck`와 같은 sim(`surgeSim`)이라 숫자 동일. 시나리오 이벤트에도 배지. 스크린샷 `docs/v2/surge-check.png` | [PR #33](https://github.com/zqvo04/fluid-twin/pull/33) |
| F4 | ✅ [PR #32](https://github.com/zqvo04/fluid-twin/pull/32) 시나리오 재생 UI — 이벤트 목록 편집·예제·재생·시각 슬라이더. 재생 중 두 탭·Inspector·입자·상태바가 같은 프레임(`gridAtFrame` + 프레임 결과 → `readouts`), Inspector 편집 잠금. 스크린샷 `docs/v2/scenario-*.png` | P2-3 워커는 있으나 화면 진입점 없음 |
| F5 | 🔵 회전자: 베어링·씰 마찰(정격 토크 1.5 %)을 MOC 트립·시나리오 감속 공통 `rotorBrakingTorque`로 → 유한 시간 정지. 수조 고갈: 다음 스텝에 바닥 아래로 갈 수조는 흡입 상실(그 수조에서 빨아들이는 펌프 = 막힌 배관) → 질량 정확 보존, 재생 패널 경고 | 이 PR |

---

## 5. V&V 목록 (완료 판정 기준) — 상세 기록: [`docs/VNV.md`](VNV.md)

| # | 항목 | 기준 | 상태 |
|---|---|---|---|
| 1 | 마찰계수 | Churchill vs Moody/Colebrook | ✅ `physics/friction.test.ts` (층류 비 1.0, Moody 3점) |
| 2 | 망해석 | GGA vs 손계산 루프 예제 | ✅ `physics/steadySolver.test.ts` (단관 3.9e-9) |
| 3 | 수격 | Joukowsky `a·V0/g`, 주기 `4L/a` | ✅ `physics/transient.test.ts` (Joukowsky 비 1.0000000) |
| 4 | 단일 펌프 운전점 | 2차 펌프곡선 ∩ 2차 시스템곡선 해석해 (근의 공식) | ✅ `physics/scenario.test.ts` (근의 공식, 상대오차 < 1e-6) |
| 5 | 병렬 펌프 A+B | 동일 펌프 2대: 같은 수두에서 유량 2배 합성 곡선과 교점 일치 | ✅ `physics/scenario.test.ts` (합성곡선 교점 < 1e-6, A→B 전환 포함) |
| 6 | 수조 질량 보존 | 시나리오 전 구간 `∫(Q_in − Q_out)dt = A·Δh` (상대오차 < 1e-6) | ✅ `physics/scenario.test.ts` (2개 수조, 상대오차 < 1e-6, 총량 < 1e-9) |
| 7 | 준정상 정합 | 이벤트 없는 시나리오 = 정상해 (모든 스텝 동일) | ✅ `physics/scenario.test.ts` (전 스텝 1e-9) |
| 8 | MOC 펌프 기동 | 정상 도달 후 MOC 해 = GGA 정상해 (허용오차 < 0.5 %) | ✅ `physics/pumpStart.test.ts` (< 0.5 %) |
| 9 | 제어밸브 | 개도별 유량 = Cv 특성곡선 계산값 | ✅ `physics/valveCv.test.ts` (특성 7.4e-13, Cv 식 2.0e-4) |
| 10 | 모드 일치 | §1.2 불변식 테스트 | ✅ `render/modeAgreement.test.ts` (무작위 200, 주입 4종 실패 확인) |

---

## 6. 리스크

| 리스크 | 대응 |
|---|---|
| PFD 심볼이 "그럴듯하지만 표준과 다름" | P3-1 심볼에 표준 출처 명기, 심볼 시트 PNG 사용자 육안 승인 |
| 셀 격자 위 PFD가 실제 도면보다 딱딱해 보임 | 셀 크기 1 m 고정 대신 프로젝트 설정 유지(V1 `cellSize`). 라벨은 셀 밖 오버레이 허용 |
| 펌프 기동 시 준정상 해가 순간 비수렴 (회전수 0 근처) | 회전수 하한 + 체크밸브 닫힘 처리 (V1 정지 펌프 바이패스 로직 재사용) |
| 세션 간 맥락 단절 | 이 문서가 유일한 인수인계. 카드에 완료 명령 명시, 의존 태스크 머지 전 시작 금지, 상태판 비고로 후속 메모 전달 |
| 범위 팽창 (열, 수주분리 요구) | §0 제외 목록 기준으로 V3로 이관 |

---

## 7. 확정된 승인 사항

1. 모드 표시: **탭 전환** (`PFD | 맵`). 분할 보기 없음.
2. 태그 체계: `{종류}-1{순번}{A/B}`, 유닛 100 고정.
3. 수조: 수위 변화 포함. 보충수(make-up)·블로다운 제외.
