# 🔍 Problem Radar

**한국 사용자들의 반복되는 불평에서 사업 기회를 찾는 자동화 시스템**

> "방법이 없나요?" "매번 이렇게 해야 하나요?" "왜 이런 기능이 없죠?"
> 이런 문장이 사업 아이디어의 원재료다.

---

## 목표

```
정보 10만 개 수집   ❌
문제 1,000개 발견   ❌
좋은 문제 30개 확보  ✅
검증할 문제 5개      ✅
돈 내는 고객 있는 문제 1개  ✅
```

---

## 시스템 구조

```
[정보 수집]
├── 네이버 지식iN  (공식 검색 API)
├── 네이버 블로그  (공식 검색 API)
├── 구글 플레이 리뷰  (★1~2점만)
├── 앱스토어 리뷰     (★1~2점만)
└── 직접 제보         (Telegram)
         ↓
[수집/정제]
├── 불평 시그널 키워드 필터
├── 원문 단위 중복 제거
└── 원문 정규화
         ↓
[AI 분석 — 무료 한 배치 + 근거 기반 분석]
├── 문제 구조화
├── 원문 근거·신뢰도·검증 질문 추출
├── 점수 산정 (코드에서 0~100 재계산)
└── 동일 문제군·증거 수 표시
[Problem DB — 사용자가 실행한 수집만 자동 등록]
         ↓
[사람이 독립 원문을 보강]
         ↓
[인터페이스 — Telegram 봇]
├── /collect — 즉시 수집 실행
├── /top     — TOP 10 조회
├── /today   — 오늘 수집 현황
├── /why     — 5 Why 분석
└── /status  — 시스템 상태
```

---

## 점수 공식

| 항목 | 가중치 |
|------|--------|
| 빈도 (frequency) | 20% |
| 고통 (pain) | 20% |
| 지불의사 (willingness_to_pay) | 20% |
| 시장 크기 (market_size) | 15% |
| 경쟁 기회 (competition_gap) | 10% |
| 내 해결능력 (my_fit) | 15% |
| 개발 난이도 (development_difficulty) | -10% |

**기본 기준: 한 번에 AI 분석 5건·배치 실패 시 개별 재시도 없음, 사용자가 실행한 수집 결과만 Notion 자동 저장**

규칙 기반 사전 점수와 AI 점수는 후보 선별에만 사용한다. `npm run collect`는
AI 분석을 통과한 상위 5건을 Notion에 자동 등록하고, 원문 근거를 터미널에 함께 보여 준다.
같은 고객, 상황, 임시방편을 보여 주는 독립 원문 3개(또는 현재 지출과 접근 가능한 고객)가
확인된 항목만 검증 실험으로 넘긴다.

---

## 설치 & 설정

### 1. 패키지 설치

```bash
cd /Users/taenam/business/problem-radar
npm install
```

### 2. 환경변수 설정

```bash
cp .env.example .env
```

`.env` 파일 작성:

```env
# Notion — airrouteX와 동일 토큰 사용 가능
NOTION_TOKEN=ntn_...
NOTION_PARENT_PAGE_ID=<Notion 페이지 ID>

# AI — airrouteX와 동일 키 사용 가능
GEMINI_API_KEY=AIza...

# 네이버 검색 API (새로 발급 필요)
# 발급: https://developers.naver.com/apps
NAVER_CLIENT_ID=
NAVER_CLIENT_SECRET=

# Telegram — airrouteX와 동일 토큰/ID 사용 가능
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

### 3. Notion DB 초기화

```bash
# .env에 NOTION_PARENT_PAGE_ID 설정 후:
node scripts/setup-notion.js

# 출력된 DB ID를 .env에 추가:
# NOTION_PROBLEM_DB_ID=...
# NOTION_WEAPON_DB_ID=...
```

---

## 실행

```bash
# 봇 모드 (Telegram에서 명령 대기)
npm run bot

# 1회 수집 + 분석 + Notion 자동 등록 (명령은 사용자가 직접 실행)
npm run collect

# TOP 10 터미널 출력
npm run top

# Notion DB 초기화
npm run setup:notion
```

## 데이터 해석 원칙

- Notion 항목은 검증된 사업 기회가 아니라 검증할 문제 가설이다.
- `점수`는 우선순위 정렬용 지표이며 지불의사를 증명하지 않는다.
- AI 유사군의 건수는 증거 수가 아니다. 서로 다른 원문에서 고객·상황·현재 대안이
  일치하는 것을 사람이 확인했을 때만 증거 수를 올린다.
- 다음 단계는 MVP 개발이 아니라 실제 고객에게 검증 질문을 하고 수동 제안을 하는 것이다.

## 문제 수집함 구조

테이블에서는 `문제`, `상태`, `대상`, `근거 유형`, `동일 문제 증거수`만 보고 후보를 고른다.
`점수`, `수집일`, `원문링크`, `원문ID`는 정렬·중복 방지용으로 숨긴다. 원문 인용, 출처,
현재 해결 방식, 해결 공백, 근거 부족, 검증 질문·제안은 각 항목 페이지 본문에 자동 기록한다.

---

## 수집 소스 추가 방법

### 앱 리뷰 대상 앱 추가

`src/config/index.js` → `COLLECT_CONFIG.apps.targets`:

```js
{ store: 'google', id: 'com.example.app', name: '앱 이름' },
{ store: 'apple', id: 123456789, name: '앱 이름' },
```

### 네이버 검색 키워드 추가

`src/config/index.js` → `COLLECT_CONFIG.naver.searchQueries`:

```js
'병원 예약 불편',
'보험 갱신 어렵',
```

---

## 직접 제보 방법

Telegram에서 다음 형식으로 전송:

```
[문제]
직장인이 매달 복지포인트 사용처를 찾느라 여러 사이트를 돌아다님.

[내 생각]
한곳에서 검색하면 좋을 듯
```

AI가 자동으로 구조화하고 점수를 매겨 Notion에 저장합니다.

---

## TODO (미완성 기능)

- [ ] 네이버 데이터랩 API 연동 — 검색량 추이로 "수요 검증 레이어" 추가
- [ ] 클리앙 / 뽐뿌 / 보배드림 커뮤니티 수집기 추가
  - 접근 방식: robots.txt 확인 후 허용 범위 내 수집
- [ ] 네이버 쇼핑 상품 리뷰 수집기 추가
- [ ] 문제 임베딩 + 군집화 — "여러 사람이 반복하는 문제" 자동 감지
- [ ] 수집 자동화 — node-cron으로 매일 오전 7시 실행
- [ ] 블라인드 (직장인 불평) — 접근 방법 검토 필요
- [ ] 문제 상태 관리 플로우 — 수집됨 → 인터뷰예정 → 검증완료

---

## 프로젝트 구조

```
problem-radar/
├── src/
│   ├── index.js                 # 메인 엔트리포인트
│   ├── config/
│   │   └── index.js             # 설정 (키워드, 점수 가중치, 나의 역량)
│   ├── collectors/
│   │   ├── naver-kin.js         # 네이버 지식iN + 블로그 수집기
│   │   └── app-reviews.js       # 구글플레이 + 앱스토어 수집기
│   ├── services/
│   │   ├── ai-analyzer.js       # Gemini AI 분석 엔진
│   │   ├── notion-service.js    # Notion DB 저장/조회
│   │   └── telegram-bot.js      # Telegram 봇 인터페이스
│   └── prompts/
│       └── analyze.js           # AI 분석 프롬프트
└── scripts/
    └── setup-notion.js          # Notion DB 초기화
```
