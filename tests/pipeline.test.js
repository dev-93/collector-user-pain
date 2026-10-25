import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectCandidate, sourceKeys, sourceIdentity, validationEligibility } from '../src/utils/candidate-policy.js';
import { runCollection, planStorage } from '../src/services/collection-pipeline.js';
import AIAnalyzer, { parseBatchJSON, materializeAnalysis } from '../src/services/ai-analyzer.js';
import NotionService from '../src/services/notion-service.js';
import ValidationService from '../src/services/validation-service.js';
import { preFilter } from '../src/utils/pre-filter.js';
import { buildBatchAnalysisPrompt } from '../src/prompts/analyze.js';

// 실제 API가 호출되면 테스트 자체를 실패시킨다.
globalThis.fetch = async () => { throw new Error('Network forbidden in tests'); };
const now = new Date('2026-10-25T09:00:00Z');
const direct = (text = '직접 운영하는 식당에서 예약 취소로 재료를 폐기했습니다.') => ({ source: '직접 제보', original_text: text, evidence_state: 'self_report' });
const original = (extra = {}) => ({ source: '허용된 테스트 출처', original_text: '카페 운영 중 매일 정산에 1시간을 쓰고 있습니다.',
  source_url: 'https://example.org/posts/1', published_at: '2026-10-24T09:00:00+09:00', original_verified: true,
  date_verified: true, author_key: 'synthetic-author', record_type: 'failure', ...extra });
const parsed = { problem_summary: '식당 예약 취소로 재료 폐기', target_user: '식당 운영자', context: '예약 당일 취소',
  frequency: 3, pain: 4, willingness_to_pay: 1, evidence_quote: '예약 취소로 재료를 폐기했습니다.',
  evidence_type: '정보 부족', evidence_gaps: ['반복 빈도 미확인'], is_estimated: true, cost_bearer: '식당 운영자' };

test('당근은 공개 접근/확인 플래그와 무관하게 AI 전송 차단', async () => {
  for (const source_url of ['https://cafe.daangn.com/x6idgz/posts/test', 'https://www.daangn.com/kr/community/test']) {
    assert.equal(inspectCandidate(original({ source_url }), { now }).disposition, 'permission_required');
  }
  let calls = 0;
  const report = await runCollection([direct('당근 카페 https://cafe.daangn.com/x6idgz/posts/test 원문')], { analyzer: { analyzeAll: () => { calls++; } } });
  assert.equal(calls, 0);
  assert.equal(report.counts.permission_required, 1);
});

test('7일·미래·날짜 미확인·접근 불가·회복 사례 구분', () => {
  assert.equal(inspectCandidate(original(), { now }).disposition, 'eligible');
  assert.equal(inspectCandidate(original({ published_at: '2026-10-10' }), { now }).disposition, 'excluded');
  assert.equal(inspectCandidate(original({ published_at: '어제' }), { now }).disposition, 'needs_research');
  assert.equal(inspectCandidate(original({ published_at: '2026-02-30' }), { now }).disposition, 'needs_research');
  assert.equal(inspectCandidate(original({ published_at: '2026-10-26' }), { now }).disposition, 'needs_research');
  assert.equal(inspectCandidate(original({ access: 'login_required' }), { now }).disposition, 'inaccessible');
  assert.equal(inspectCandidate(original({ record_type: 'recovery' }), { now }).disposition, 'needs_research');
  assert.equal(inspectCandidate(original({ record_type: 'operator' }), { now }).disposition, 'excluded');
});

test('광고·후기·오류 단어를 포함한 실제 운영 손실을 자동 기각하지 않음', () => {
  const candidates = [direct('매달 광고비 30만원을 쓰는데 정산 오류로 수작업에 매주 2시간을 쓰는 식당 사장 후기입니다.')];
  assert.equal(preFilter(candidates, { verbose: false }).length, 1);
});

test('같은 제목의 다른 사건은 유지, 추적 URL·같은 작성자 사건·문구 복제는 중복', async () => {
  const items = [original({ raw_title: '예약 취소', original_text: '사건 하나' }),
    original({ raw_title: '예약 취소', original_text: '다른 고객 사건', source_url: 'https://example.org/posts/2' }),
    original({ source_url: 'https://example.org/posts/1?utm_source=chat#abc', original_text: '사건 하나' }),
    original({ source_url: 'https://example.org/posts/3', original_text: '같은 사건', author_key: 'a', event_key: 'b' }),
    original({ source_url: 'https://example.org/posts/4', original_text: '재게시', author_key: 'a', event_key: 'b' })];
  const report = await runCollection(items, { now });
  assert.equal(report.counts.unique, 3);
  assert.equal(report.counts.duplicate, 2);
});

test('출처 식별자 해시에는 원문이 포함되지 않고 재실행해도 안정적', () => {
  const candidate = direct('민감한 고객 관찰을 식별자에 그대로 넣지 않습니다.');
  const id = sourceIdentity(candidate);
  assert.match(id, /^text:[a-f0-9]{64}$/);
  assert.equal(sourceIdentity({ ...candidate, source_item_id: id }), id);
  assert.ok(sourceKeys({ source_item_id: id }).includes(`id:${id}`));
});

test('배치 배열 개수 불일치를 거부', () => {
  assert.equal(parseBatchJSON('[{}]', 2), null);
  assert.equal(parseBatchJSON('설명 [{}, {}]', 1), null);
  assert.equal(parseBatchJSON('```json\n[{},{}]\n```', 2).length, 2);
});

test('낮은 점수·정보 부족도 보존하고 AI 증거수·사람 확인값은 폐기', async () => {
  const candidate = direct();
  const result = materializeAnalysis({ ...parsed, evidence_count: 999, human_review: { reviewed_by: 'AI' } }, candidate);
  assert.equal(result.status, '수집됨');
  assert.equal(result.review_disposition, 'needs_research');
  assert.equal(result.evidence_count, 0);
  assert.equal(result.human_review, undefined);
  const report = await runCollection([candidate], { analyzer: { analyzeAll: async (items) => [materializeAnalysis(parsed, items[0])] } });
  assert.equal(report.counts.needs_research, 1);
  assert.equal(report.records[0].plan.action, 'create_candidate');
});

test('AI 인용을 원문과 대조하고 400자 이후 원문을 배치에서도 유지', () => {
  assert.equal(materializeAnalysis({ ...parsed, evidence_quote: '가짜 인용' }, direct()).evidence_quote, null);
  const tail = '마지막 문장에 손실 30만원과 현재 대안이 있습니다.';
  assert.ok(buildBatchAnalysisPrompt([direct('앞'.repeat(500) + tail)]).includes(tail));
});

test('AI 실패·한도 초과분 원문을 사라지게 하지 않음', async () => {
  let count;
  const report = await runCollection(Array.from({ length: 7 }, (_, i) => direct(`각기 다른 식당의 운영 관찰 ${i}`)),
    { analyzer: { analyzeAll: async (items) => { count = items.length; return []; } } });
  assert.equal(count, 5);
  assert.equal(report.records.length, 7);
  assert.equal(report.counts.needs_research, 7);
  assert.equal(report.records.filter((r) => r.plan.action === 'hold').length, 7);
});

test('기존 원문은 AI 전에 제외하고 비슷한 문제는 증거 추가 검토로 돌림', async () => {
  const candidate = original(); let called = false;
  const report = await runCollection([candidate], { now, existing: [{ ...candidate, id: 'existing' }],
    analyzer: { analyzeAll: async () => { called = true; return []; } } });
  assert.equal(called, false);
  assert.equal(report.records[0].plan.action, 'skip_duplicate');
  assert.equal(planStorage({ problem_summary: '식당 예약 취소로 재료 폐기' }, [{ id: 'p', problem_summary: '식당 예약 취소로 재료 폐기 손실' }]).action, 'review_evidence_match');
});

const schema = Object.fromEntries(['문제', '상태', '원문ID', '동일 문제 증거수', '수집일', '근거 유형', '원문링크', '대상', '플랫폼'].map((x) => [x, {}]));
test('운영 DB에 없는 점수·카테고리를 쓰지 않으며 증거수는 항상 0', async () => {
  let payload;
  const notion = new NotionService({ problemDbId: 'db', client: { databases: {
    retrieve: async () => ({ properties: schema }), query: async () => ({ results: [], has_more: false }) },
    pages: { create: async (data) => { payload = data; return { id: 'new' }; } } } });
  await notion.saveProblem(materializeAnalysis({ ...parsed, evidence_count: 20, problem_category: '반복 작업' }, direct()));
  assert.equal(payload.properties['점수'], undefined);
  assert.equal(payload.properties['카테고리'], undefined);
  assert.equal(payload.properties['동일 문제 증거수'].number, 0);
  assert.equal(payload.properties['상태'].select.name, '수집됨');
});

test('Notion 중복 조회 실패 시 신규 생성 금지', async () => {
  let created = false;
  const notion = new NotionService({ problemDbId: 'db', client: { databases: { query: async () => { throw new Error('read denied'); } },
    pages: { create: async () => { created = true; } } } });
  await assert.rejects(notion.saveProblem(materializeAnalysis(parsed, direct())), /중복 조회 실패/);
  assert.equal(created, false);
});

test('페이지네이션과 점수 없는 DB 조회 지원', async () => {
  let requests = [];
  const notion = new NotionService({ problemDbId: 'db', client: { databases: { retrieve: async () => ({ properties: schema }),
    query: async (request) => { requests.push(request); return { results: [], has_more: requests.length === 1, next_cursor: 'next' }; } } } });
  await notion.getAllProblems();
  assert.equal(requests[1].start_cursor, 'next');
  requests = [];
  await notion.getTopProblems(999);
  assert.equal(requests[0].page_size, 100);
  assert.equal(requests[0].sorts[0].property, '수집일');
});

test('검증 자동 승격·사용자 승인 없는 생성·동시 후보 2개를 차단', async () => {
  let created = false;
  const service = new ValidationService({ validationDbId: 'lab', client: { databases: { query: async () => ({ results: [{ id: 'active', properties: {} }] }) },
    pages: { create: async () => { created = true; } } } });
  assert.deepEqual(await service.autoCreateFromProblems([{ score: 100 }]), []);
  await assert.rejects(service.createValidationExperiment({}), /사용자 결정/);
  await assert.rejects(service.createValidationExperiment({ id: 'p', human_review: { reviewed_by: 'user', reviewed_at: '2026-10-25', independent_failure_count: 3 } }, 'the-mom-test', { approved: true }), /최대 1개/);
  assert.equal(validationEligibility({ evidence_count: 99 }), false);
  assert.equal(created, false);
});

test('AI 배치 파싱 실패는 개별 호출 재시도 없이 원문 보류', async () => {
  const analyzer = Object.create(AIAnalyzer.prototype);
  analyzer.analyzeBatch = async () => null;
  analyzer.analyze = async () => { throw new Error('개별 호출 금지'); };
  assert.deepEqual(await analyzer.analyzeAll([direct()]), []);
});

test('공급자 예외도 원문을 보존하며 단순 불만은 Notion 생성 계획에서 제외', async () => {
  const report = await runCollection([direct()], { analyzer: { analyzeAll: async () => { throw new Error('provider unavailable'); } } });
  assert.equal(report.records[0].disposition, 'needs_research');
  assert.equal(report.records[0].plan.action, 'hold');
  const complaint = await runCollection([direct()], { analyzer: { analyzeAll: async (items) => [materializeAnalysis({ ...parsed, evidence_type: '단순 불만' }, items[0])] } });
  assert.equal(complaint.records[0].plan.action, 'hold');
});

test('승인된 증거 후보 추가도 기존 증거수를 변경하지 않고 본문 중복을 확인', async () => {
  let appendCount = 0;
  const blocks = [];
  const notion = new NotionService({ problemDbId: 'db', client: { pages: { retrieve: async () => ({ parent: { database_id: 'db' }, properties: {} }) },
    blocks: { children: { list: async () => ({ results: blocks, has_more: false }),
      append: async ({ children }) => { appendCount++; blocks.push(...children); } } } } });
  const review = { approved: true, same_problem: true, reviewed_by: 'user', reviewed_at: '2026-10-25' };
  await assert.rejects(notion.appendEvidenceCandidate('p', original()), /승인/);
  const result = await notion.appendEvidenceCandidate('p', original(), review);
  assert.equal(result.evidence_count_changed, false);
  assert.equal((await notion.appendEvidenceCandidate('p', original(), review)).skipped, true);
  assert.equal(appendCount, 1);
});

test('AI 배치 순서와 잘못된 스키마 응답은 채택하지 않음', async () => {
  const analyzer = Object.create(AIAnalyzer.prototype);
  analyzer.generateText = async () => JSON.stringify([{ ...parsed, input_index: 1 }]);
  assert.equal(await analyzer.analyzeBatch([direct()]), null);
  analyzer.generateText = async () => JSON.stringify([{ ...parsed, input_index: 0 }]);
  assert.equal((await analyzer.analyzeBatch([direct()]))[0].evidence_count, 0);
});

test('증거 본문에서 읽은 사건·원문 키도 다음 실행의 AI 호출 전에 중복으로 인식', async () => {
  const candidate = original({ author_key: 'anon', event_key: 'same-incident' });
  const keys = sourceKeys(candidate).filter((key) => /^(event|text):/.test(key));
  const existing = [{ id: 'parent', known_source_keys: keys, evidence_source_ids: [sourceIdentity(candidate)] }];
  const report = await runCollection([{ ...candidate, source_url: 'https://example.org/reposted' }], { now, existing });
  assert.equal(report.records[0].disposition, 'duplicate');
});

test('기존 DB 본문의 추가 증거 식별자를 페이지네이션으로 읽어 중복 계획에 반영', async () => {
  const candidate = original();
  const identity = sourceIdentity(candidate);
  const notion = new NotionService({ problemDbId: 'db', client: { databases: {
    query: async () => ({ results: [{ id: 'p', properties: {} }], has_more: false }) }, blocks: { children: {
    list: async ({ start_cursor }) => start_cursor ? { results: [{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: `증거 후보 원문ID: ${identity}` }] } }], has_more: false }
      : { results: [], has_more: true, next_cursor: 'block-next' } } } } });
  const existing = await notion.getAllProblems();
  assert.deepEqual(existing[0].evidence_source_ids, [identity]);
  assert.equal(planStorage({ ...candidate, source_item_id: identity }, existing).action, 'skip_duplicate');
});
