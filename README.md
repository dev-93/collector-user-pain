# Problem Radar

AI나 개발자가 수집 흐름을 파악하려면 먼저 [수집 시스템 빠른 안내](docs/COLLECTION_MAP.md)를 읽는다. 출처·구현 상태·필터·AI 입력·저장 경로를 한곳에서 확인할 수 있다.

### 출처 조사 상태

Hacker News는 사용자 결정으로 제외했고 시험 코드를 제거했다. 운영 수집 출처는 아직 미연결이다. 한국 거주 외국인 공개 커뮤니티를 조사하는 파일럿 가설은 [Notion 기준](https://app.notion.com/p/403eb93112d5817b800ddf6eeb176451)을 따른다. 새 출처 후보를 넓게 조사하고, 사전 기준을 통과한 최대 3곳을 7일 비교 대상으로 제안한다. 당근의 기존 접근·이용 조건 확인 원칙은 유지한다.

기존 리모트의 `skills/community-pain-research`와 채널 메모는 보존한다. 당근 카페 ChatGPT 예약 프롬프트는 `skills/community-pain-research/references/daangn.md`에 있으며 본 코드의 배치와 별도다. 스킬의 국내 사장 중심 기준을 한국 거주 외국인 파일럿에 그대로 적용하지 않는다. 지식iN·디시인사이드는 탐색 채널에서 제외한다. 기타 공개 커뮤니티 추가는 접근 조건과 원문 품질을 확인한 뒤 채널 메모로 기록한다.

반복되는 고객의 손실·현재 대안·지출을 기록하고, 원문으로 확인할 문제 가설을 고르는 조사 보조 도구다. AI 점수는 수요나 지불 의사의 증거가 아니다.

## 현재 동작

- Telegram `[문제]`·`[제보]` → 원문 정책 확인 → 기존 증거 중복 확인 → AI 분석 → 추가 조사/문제 가설 분류 → Notion 수집함.
- 낮은 점수·정보 부족을 자동 기각하지 않는다. `정보 부족`이나 추정이 많은 결과는 추가 조사 후보로 본문에 표시한다. 단순 불만은 저장 계획에서 제외한다.
- 배치 자료는 `review` 명령으로 같은 처리 흐름을 사용한다. 기본은 로컬 점검이며 AI 호출·Notion 쓰기가 없다.
- 원문 ID·정규화 URL·작성자와 사건 식별값·문구 해시로 중복을 확인한다. 같은 제목의 다른 사건을 지우지 않는다. 같은 문구는 복제 의심으로 보수적으로 중복 처리한다.
- 기존 문제와 의미가 비슷하면 새 페이지 생성 대신 `review_evidence_match`로 보류한다. AI 유사도는 독립 증거가 아니다.
- 모든 자동 신규 항목의 `동일 문제 증거수`는 0이다. 사용자 승인 후 본문에 증거 후보를 추가하는 서비스 메서드가 있으며, 증거수는 변경하지 않는다. CLI에서 운영 적용을 자동 실행하지 않는다.
- 검증 실험실 자동 승격은 꺼져 있다. 사용자 결정, 사람이 판독한 진입 근거, 활성 후보 최대 1개 조건이 필요하다.

## 외부 수집과 당근 이전

`npm run collect`는 외부 자동 수집 비활성 안내만 출력한다. 스케줄러를 설치하지 않는다.

2026-10-25 확인한 [당근 이용약관](https://www.daangn.com/policy/terms/)은 사전 서면 동의 없는 자동 수집·저장과 AI 데이터 마이닝을 제한한다. [robots.txt](https://cafe.daangn.com/robots.txt)는 GPTBot 등 여러 AI 수집기를 차단한다. 공개 열람 가능 여부만으로 수집 권한을 인정하지 않는다.

대상 카페 `x6idgz`, `sajangnimdeulkk`, `jayeong-eob-gom`은 조사 대상 설정이며, 실행 가능한 크롤러가 아니다. 당근 자료와 당근 링크를 포함한 제보는 서면 허용 범위를 확인하기 전 `permission_required`로 보류하고 AI에 전송하거나 자동 저장하지 않는다. 로그인·회원 전용 글은 우회하지 않는다.

기존 ChatGPT 오후 6시 예약은 변경하지 않았다. 실제 예약 정의·시간대·실행 이력·중복 판정 기록은 아직 이전되지 않았다. 이전 조건과 조사 결과는 [리팩터링 조사 보고서](docs/refactor-audit-2026-10-25.md)를 참조한다.

## 실행

Node.js 22 이상. 기존 설치 환경을 사용하며 새 의존성을 추가하지 않았다.

```bash
npm install
cp .env.example .env
# .env에 기존 Notion DB·AI·Telegram 자격 증명을 입력한다. 값은 커밋하지 않는다.
npm test
npm run compare
npm run review -- --input tests/fixtures/collection.json
npm run collect
npm run validate
```

`test`, 기본 `compare`, 기본 `review`, `collect`, `validate`는 외부 API를 호출하지 않는다.

```bash
# 운영 제보 수신과 Notion 저장을 시작한다. 실제 운영 전 연결과 저장 결과를 별도로 확인한다.
npm run bot
# 기존 DB 조회. 점수 필드가 없으면 수집일 역순이다.
npm run top
npm run valstat
```

AI 키는 OpenRouter → Groq → Gemini 순서이며 설정된 공급자만 사용한다. 모델 이름은 `src/config/index.js`에 있다. 한 번 실행에 최대 5건, 개별 재시도는 기본 비활성이다. 실제 모델 가용성·무료 한도·요금은 공급자 계정에서 별도 확인한다.

## 로컬 배치 점검

```bash
# 외부 호출/운영 쓰기 없이 분류·탈락 사유만 출력
npm run review -- --input /path/to/records.json --existing /path/to/existing.json
# 원문을 담은 결과를 로컬에 보존. 덮어쓰기 방지를 위해 새 파일 경로를 사용한다.
npm run review -- --input /path/to/records.json --output data/review-new.json
# 아래 옵션은 외부 API를 사용한다. 허용된 자료로 실사용을 명시적으로 결정한 때만 실행한다.
npm run review -- --input /path/to/records.json --notion-read --analyze --output data/review-new.json
```

`--notion-read`는 기존 DB·본문의 증거 후보 식별자를 읽기만 한다. `--analyze`는 정책을 통과한 자료만 최대 5건 AI로 전송한다. 어느 옵션도 Notion에 쓰지 않는다. `--output`을 생략하면 원문 없는 집계·판정만 출력하므로 미분석 원문을 보존하려면 입력 파일을 유지해야 한다. `data/`, `output/`, `.env`, 로그는 Git 제외 대상이다.

입력은 다음 객체의 JSON 배열이다. 외부 원문의 `original_verified`, `date_verified`, 작성자·사건 키는 사람이 실제 원문을 확인한 후 입력한다. 요약 도구나 AI가 만든 확인값을 넣지 않는다.

```json
[
  {
    "source": "직접 제보",
    "original_text": "직접 겪은 사건과 손실, 현재 대응 방법",
    "evidence_state": "self_report"
  }
]
```

외부 자료에는 `source_url`, `published_at`(시간대가 있는 ISO 시각 또는 한국 날짜), `original_verified`, `date_verified`, `author_key`(익명 식별값), `record_type`을 추가한다. 같은 작성자의 같은 사건은 `event_key`로 묶는다. `record_type`은 `failure`, `recovery`, `advertisement`, `operator`, `general`, `repost`를 구분한다. 최근 7일은 실행 시각 기준 168시간이며 날짜만 있으면 한국시간 00:00으로 해석한다. 게시일 미확인·미래 날짜는 추가 조사, 7일 초과는 제외한다. 회복 사례는 실패 근거로 더하지 않는다.

## Notion

기존 수집함·검증 실험실을 재사용한다. 기존 DB 초기화 스크립트는 새 공간용이므로 운영 DB에 재실행하지 않는다.

- 수집함: `문제`, `상태`, `대상`, `근거 유형`, `동일 문제 증거수`, 출처·식별용 속성.
- 기존 `플랫폼` 속성이 있으면 유지한다. DB 스키마나 선택지를 임의 변경하지 않는다.
- 원문과 게시일 메타데이터, AI 추론, 부족한 근거, 추가 조사 분류는 페이지 본문에 기록한다.
- `점수`·`카테고리`는 DB에 있을 때만 쓴다. DB 스키마를 자동 변경하지 않는다.
- 중복 조회·본문 증거 조회가 실패하면 신규 생성을 중단한다.
- 증거 추가는 `appendEvidenceCandidate(pageId, candidate, review)`를 사용자 승인 후 호출한다. 증거수와 실험실은 변경하지 않는다.
- 자동 승격 API는 비활성이다. `createValidationExperiment`는 명시적 승인과 사람 검토값이 있어야 하며, 활성 실험이 있으면 거부한다. 시작일은 임의 입력하지 않는다.

단일 봇 프로세스 안의 제보는 순차 처리한다. 여러 프로세스 사이의 분산 잠금은 구현하지 않았다. 예약 전환 전 단일 실행 보장·이력 이전·재실행 점검이 필요하다.

## Railway 아침 배치 준비

아직 운영 자동 수집은 활성화하지 않았다. `npm run daily -- --check`는 외부 호출 없이 출처·환경변수·영구 저장소 설정 유무만 확인한다. 실제 키 유효성이나 API 권한을 검증하는 명령은 아니다.

- `npm run daily`는 외부 호출 없는 미리보기다. `--input <파일>`로 로컬 JSON 배열을 넣을 수 있다. 미리보기 이력은 `data/batch-preview`에 남으며 같은 날 재실행하면 저장된 결과를 반환한다.
- `npm run daily -- --live`는 등록된 출처 읽기, 기존 Notion 읽기, 최대 5건 AI 분석, 선택적 Telegram 보고를 순서대로 실행하고 종료한다. Notion 쓰기는 하지 않는다.
- 폴백 순서는 OpenRouter → Groq → Gemini를 유지한다. 분석 5건은 API 요청 5회를 뜻하지 않는다. 보고에 공급자별 요청 횟수·상태를 집계한다.
- `config/sources.json`은 현재 비어 있다. 지원 어댑터는 검토된 원문 자료의 JSON 배열뿐이다. RSS·검색·커뮤니티 수집기는 구현하지 않았다. 출처마다 자동 읽기·AI 처리·보관 허용 근거와 검토자를 등록해야 한다. 원문·게시일 확인값은 수집기가 생성하지 않는다.
- `railway.batch.json`은 선택적으로 적용할 준비 파일이다. 매일 한국시간 08:00(UTC `0 23 * * *`), 시작 명령 `npm run daily -- --live`, 재시작 정책 `NEVER`다. 기존 Telegram 봇 실행 명령과 구분한다.
- 영구 Volume을 `/data`에 연결하고 `RADAR_STATE_DIR=/data/problem-radar`를 설정한다. 단일 replica만 사용한다. 같은 저장소의 파일 잠금·날짜별 이력으로 재분석을 막는다. 강제 종료로 잠금이 남으면 실행 중인 프로세스가 없는지 확인한 뒤 수동 복구한다.
- AI 호출 전에 시도 이력을 저장하므로 같은 날 재시작해도 재호출하지 않는다. 미분석 자료는 다음 날 재검토하며, 7일을 넘긴 외부 원문은 기존 기준대로 제외한다. Telegram 전송 결과가 불명확하면 자동 재발송하지 않고 수동 확인한다.

운영 전 남은 작업: 허용된 출처 확정, Railway 환경변수 설정, Volume 연결, 배치 설정 적용, 실사용 1회 결과·중복 방지 검증. 출처가 없으면 실행은 차단된다. 저장소 push나 배포 적용은 별도 수행해야 한다.
