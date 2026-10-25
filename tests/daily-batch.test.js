import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BatchStore } from '../src/services/batch-store.js';
import { runDailyBatch, koreanDate } from '../src/services/daily-batch.js';
import { validateSources, collectSources } from '../src/services/source-loader.js';
import { sendTelegramReport } from '../src/services/report-sender.js';
import AIAnalyzer from '../src/services/ai-analyzer.js';

const now = new Date('2026-10-25T00:00:00Z');
const source = { id: 'consented', type: 'json', url: 'https://example.org/approved.json',
  permission: { reviewed_by: 'fixture', reviewed_at: '2026-10-25', reference: 'test-only-consent', automated_read: true, ai_analysis: true, retention: true } };
const item = (i = 0) => ({ source: '직접 제보', evidence_state: 'self_report', original_text: `직접 운영하는 매장에서 반복해서 물품을 재주문합니다. 독립 제보 ${i}` });
const collect = async () => ({ sources: [{ id: 'fixture', status: 'ok', count: 1 }], candidates: [item()] });
const analyzed = (c) => ({ ...c, analysis_status: 'ai_analyzed', score: 20, problem_summary: '반복 재주문 부담',
  evidence_type: '정보 부족', evidence_quote: '물품을 재주문합니다.', is_estimated: true });
async function withStore(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'radar-batch-'));
  try { return await fn(new BatchStore(directory), directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test('한국 날짜는 UTC가 아닌 KST로 집계', () => {
  assert.equal(koreanDate(new Date('2026-10-24T23:00:00Z')), '2026-10-25');
});

test('출처 미설정·빈 결과는 LLM을 호출하지 않는다', async () => withStore(async (store) => {
  const report = await runDailyBatch({ store, now, collect: async () => ({ sources: [], candidates: [] }),
    analyzerFactory: () => { throw new Error('호출 금지'); } });
  assert.equal(report.status, 'source_not_configured');
  assert.equal(report.counts.ai_requested, 0);
}));

test('동일 날짜 재실행은 분석·보고를 다시 하지 않는다', async () => withStore(async (store) => {
  let aiCalls = 0; let sends = 0;
  const args = { store, now, collect, analyzerFactory: async () => ({ analyzeAll: async (items) => { aiCalls++; return items.map(analyzed); } }),
    sendReport: async () => { sends++; return { message_id: 123 }; } };
  await runDailyBatch(args);
  const second = await runDailyBatch(args);
  assert.equal(second.replayed, true);
  assert.equal(aiCalls, 1);
  assert.equal(sends, 1);
}));

test('5건 이후와 실패한 분석은 다음 날짜에 재검토한다', async () => withStore(async (store) => {
  let sizes = [];
  const analyzerFactory = async () => ({ analyzeAll: async (items) => { sizes.push(items.length); return []; } });
  const args = { store, now, collect: async () => ({ sources: [{ id: 'fixture', status: 'ok' }], candidates: Array.from({ length: 7 }, (_, i) => item(i)) }), analyzerFactory };
  await runDailyBatch(args);
  await runDailyBatch({ ...args, now: new Date('2026-10-26T00:00:00Z') });
  assert.deepEqual(sizes, [5, 5]);
  assert.equal(Object.keys((await store.load()).items).length, 7);
}));

test('규칙 폴백을 분석 성공으로 처리하지 않고 다음 날 다시 분석한다', async () => withStore(async (store) => {
  let calls = 0;
  const args = { store, now, collect, analyzerFactory: async () => ({ analyzeAll: async (items) => { calls++; return items.map((c) => ({ ...c, analysis_status: 'rule_only' })); } }) };
  await runDailyBatch(args);
  await runDailyBatch({ ...args, now: new Date('2026-10-26T00:00:00Z') });
  assert.equal(calls, 2);
}));

test('분석 직전 체크포인트 후 강제 중단돼도 같은 날 추가 호출하지 않는다', async () => withStore(async (store) => {
  await store.save({ version: 1, items: {}, runs: { '2026-10-25': { ai_attempted: true } } });
  let calls = 0;
  const report = await runDailyBatch({ store, now, collect, analyzerFactory: () => { calls++; } });
  assert.equal(calls, 0);
  assert.equal(report.ai_deferred, true);
}));

test('Telegram 전송이 불명확하면 자동 재발송하지 않는다', async () => withStore(async (store) => {
  let sends = 0;
  const args = { store, now, collect: async () => ({ sources: [], candidates: [] }), analyzerFactory: () => null,
    sendReport: async () => { sends++; throw new Error('network timeout'); } };
  await assert.rejects(runDailyBatch(args), /report_delivery_uncertain/);
  await assert.rejects(runDailyBatch(args), /report_delivery_uncertain/);
  assert.equal(sends, 1);
}));

test('분석 완료 체크포인트는 보고 재개 시 재분석하지 않는다', async () => withStore(async (store) => {
  const report = { date: '2026-10-25', status: 'ok', counts: { input: 1, ai_analyzed: 1 }, sources: [], records: [] };
  await store.save({ version: 1, items: {}, runs: { '2026-10-25': { ai_attempted: true, report } } });
  let sent = 0;
  await runDailyBatch({ store, now, collect: () => { throw new Error('재수집 금지'); }, analyzerFactory: () => { throw new Error('재분석 금지'); },
    sendReport: async () => { sent++; return { message_id: 1 }; } });
  assert.equal(sent, 1);
}));

test('영속 저장의 원자적 잠금과 손상 상태 차단', async () => withStore(async (store, directory) => {
  await store.acquire();
  await assert.rejects(store.acquire(), /batch_locked/);
  await store.release();
  await store.save({ version: 1, items: {}, runs: {} });
  assert.equal(JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')).version, 1);
}));

test('허가 없는 출처·제한 사이트·리다이렉트 입력을 사전 차단', () => {
  assert.throws(() => validateSources([{ ...source, permission: {} }]), /source_permission_missing/);
  for (const url of ['http://example.org/a', 'https://cafe.daangn.com/a', 'https://www.reddit.com/a', 'https://127.0.0.1/a', 'https://example.org/a?token=secret']) {
    assert.throws(() => validateSources([{ ...source, url }]), /source_url_not_allowed/);
  }
  assert.equal(validateSources([source]).length, 1);
});

test('허용 JSON 원문 로드 시 확인값을 만들어 넣지 않는다', async () => {
  const result = await collectSources([source], { fetchImpl: async () => new Response(JSON.stringify([{ original_text: '직접 작성한 원문', source_url: 'https://example.org/post/1' }]),
    { headers: { 'content-type': 'application/json' } }) });
  assert.equal(result.candidates[0].original_verified, undefined);
  assert.equal(result.sources[0].status, 'ok');
  const failed = await collectSources([source], { fetchImpl: async () => new Response('<html>로그인</html>', { headers: { 'content-type': 'text/html' } }) });
  assert.equal(failed.sources[0].status, 'failed');
  assert.equal(failed.candidates.length, 0);
});

test('보고 API 오류에 토큰·응답 본문을 노출하지 않는다', async () => {
  await assert.rejects(sendTelegramReport('테스트', { token: 'secret-token', chatId: '1',
    fetchImpl: async () => new Response('secret-token', { status: 500 }) }), /^Error: telegram_send_failed$/);
});

test('기존 OpenRouter 429 → Groq 404 → 보조 Groq 성공 폴백을 유지', async () => {
  const originalFetch = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async () => {
    count++;
    return count === 1 ? new Response('', { status: 429 }) : count === 2 ? new Response('', { status: 404 })
      : new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
  };
  try {
    const analyzer = Object.create(AIAnalyzer.prototype);
    analyzer._chainIdx = 0;
    analyzer._chain = [{ name: 'OpenRouter', call: (p) => analyzer._openrouterGenerate(p) },
      { name: 'Groq', call: (p) => analyzer._groqGenerate(p) }];
    assert.equal(await analyzer.generateText('합성 테스트'), 'ok');
    assert.equal(count, 3);
    assert.deepEqual(analyzer.usage.requests.map((r) => r.status), [429, 404, 200]);
  } finally { globalThis.fetch = originalFetch; }
});
