# 수집 시스템 빠른 안내 — AI·개발자 공통

이 파일은 구현을 찾기 위한 안내다. 실행 정책의 기준은 루트 `AGENTS.md`, 실제 동작의 기준은 아래 코드다. 파일을 읽었다는 이유로 외부 API나 운영 쓰기를 실행하지 않는다.

## 목적과 관찰 대상

자영업자나 소프트웨어 불편에 한정하지 않는다. 고객 한 역할이 특정 상황에서 반복해서 떠안는 손실, 현재 대안, 시간 투자와 실제 지출을 관찰한다.

탐색 방향: 정기 청소·관리·점검·보충, 예약·서류·문의·일정 대행, 전문가·작업자 재선정과 품질 확인, 상황별 선택·준비 서비스. 이는 탐색 방향이며 수집 채널이나 확인된 시장 수요가 아니다.

## 현재 구현 상태

| 항목 | 상태 | 코드 |
|---|---|---|
| 외부 검색·커뮤니티 탐색 | 비활성. 자동 검색 어댑터 없음 | `src/index.js`의 collect 경로 |
| Hacker News | 사용자 결정으로 제외. 시험 코드 제거 | 과거 조사 기록만 보존 |
| 등록된 자동 수집 출처 | 0개. 빈 배열 | `config/sources.json` |
| 허용 자료 읽기 | 검토된 HTTPS JSON 배열만 지원. RSS·HTML 수집 미구현 | `src/services/source-loader.js` |
| 직접 제보 | Telegram의 사용자 제공 자료 처리 | `src/services/telegram-bot.js` |
| 로컬 자료 검토 | JSON 입력, 기본 외부 호출 없음 | `scripts/review-collection.js` |
| 아침 배치 | 실행 코드 준비. 설정 파일만으로 운영 활성화되지 않음 | `scripts/daily.js`, `railway.batch.json` |
| 연결 테스트 | 가상 사례 1건 → 실제 AI → Telegram. 수집 실적 아님 | `scripts/smoke-report.js` |

## 입력에서 보고까지

1. 입력: 원문 `original_text`, 출처 `source`, URL `source_url`, 게시일 `published_at`, 익명 작성자 `author_key`, 사건 `event_key`.
2. 원문 확인: 외부 자료는 `original_verified=true`, `date_verified=true`가 필요하다. 사람이 확인한 메타데이터이며 AI가 생성하지 않는다. 직접 제보는 `evidence_state=self_report`로 구분한다.
3. 정책 판정: 최근 7일, 접근 가능 여부, 자료 유형, 원문·날짜 확인 여부를 판정한다. 광고·운영자 자료·일반론·복제는 제외하며 정보 부족은 보류한다. 당근은 허용 확인 전 차단한다. → `src/utils/candidate-policy.js`
4. 중복: 원문 URL·원문 ID·작성자/사건·동일 문구와 기존 Notion 항목을 비교한다. 의미 유사도는 사람의 검토 대상이지 독립 증거가 아니다. → `src/services/collection-pipeline.js`
5. AI: 통과 후보 중 최대 5건을 배치 분석한다. OpenRouter → Groq → Gemini 폴백 때문에 요청 횟수는 1회를 넘을 수 있다. → `src/services/ai-analyzer.js`, `src/config/index.js`
6. 분석 항목: 고객, 상황, 현재 대안, 손실 부담자, 가능한 결제 역할, 원문 인용, 부족한 근거, 빈도·고통·지불 의사 평가. 추론은 증거와 구분한다. → `src/prompts/analyze.js`
7. 배치 결과: 원문·판정·분석 이력을 로컬/Volume에 보관하고 Telegram 보고를 선택적으로 발송한다. 같은 한국 날짜 재실행은 저장된 결과를 재사용한다. → `src/services/daily-batch.js`, `batch-store.js`, `report-sender.js`
8. Notion: 아침 배치는 기존 항목을 읽기만 한다. 직접 제보 저장 경로와 구분한다. 증거수 증가·검증 실험실 승격은 자동 처리하지 않는다. → `src/services/notion-service.js`, `validation-service.js`

## 실행 명령과 영향

| 명령 | 외부 호출 | 운영 영향 |
|---|---|---|
| `npm test` | 없음 | 없음 |
| `npm run daily -- --check` | 없음 | 설정 유무만 확인, 키 유효성 검증 아님 |
| `npm run review -- --input <파일>` | 없음 | 로컬 판정 |
| `node scripts/smoke-report.js --diagnose` | Telegram 읽기 | 메시지 발송 없음 |
| `node scripts/smoke-report.js` | AI·Telegram | 가상 테스트 메시지 1회, Notion 저장 없음 |
| `npm run daily -- --live` | 등록 출처·Notion 읽기·AI·선택적 Telegram | 출처·필수 설정 없으면 차단, Notion 쓰기 없음 |

운영 상태와 키 유효성은 이 문서에 고정 기록하지 않는다. 실제 실행 결과로 확인하며 비밀값을 출력하지 않는다. 새 수집기를 구현할 때 공개 접근 가능 여부와 자동 읽기·AI 처리·보관 허용 범위를 먼저 확인한다.
