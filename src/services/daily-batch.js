import { createHash } from 'node:crypto';
import { runCollection } from './collection-pipeline.js';
import { inspectCandidate, sourceIdentity } from '../utils/candidate-policy.js';

export function koreanDate(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now);
}

export function buildDailyMessage(report) {
  const counts = report.counts || {};
  const lines = [`🔎 Problem Radar · ${report.date}`, `상태: ${report.status}`,
    `입력 ${counts.input || 0}건 / AI 분석 ${counts.ai_analyzed || 0}건 / 추가 조사 ${counts.needs_research || 0}건`,
    `출처: 성공 ${report.sources.filter((s) => s.status === 'ok').length} / 실패 ${report.sources.filter((s) => s.status === 'failed').length}`];
  if (report.status === 'source_not_configured') lines.push('허용된 수집 출처가 아직 설정되지 않았습니다.');
  if (report.ai_deferred) lines.push('오늘 이미 분석을 시도해 추가 호출하지 않았습니다.');
  for (const record of report.records || []) {
    if (!record.analysis) continue;
    lines.push(`- ${String(record.analysis.problem_summary).slice(0, 160)} (${record.disposition === 'candidate' ? '문제 가설' : '추가 조사'})`);
    if (record.plan?.action === 'review_evidence_match') lines.push('  기존 문제와 증거 추가 검토 필요');
  }
  lines.push('점수·유사도는 수요의 증거가 아니며 검증 실험실은 자동 승격하지 않습니다.');
  return lines.join('\n').slice(0, 3800);
}

// 저장소·수집·AI·보고를 주입해 실제 운영과 무API 테스트를 같은 흐름으로 실행한다.
export async function runDailyBatch({ store, collect, analyzerFactory, existing = [], sendReport = null, now = new Date() }) {
  const date = koreanDate(now);
  await store.acquire();
  try {
    const state = await store.load();
    if (state.version !== 1 || !state.items || !state.runs) throw new Error('state_invalid');
    const previous = state.runs[date];
    if (previous?.status === 'complete') return { ...previous.report, replayed: true };
    // 발송 직전 체크포인트 이후 종료되었다면 발송 여부가 불명확하다. 자동 재발송하지 않는다.
    if (previous?.delivery === 'sending' || previous?.delivery === 'uncertain') {
      throw new Error('report_delivery_uncertain');
    }
    const run = previous || { started_at: now.toISOString(), ai_attempted: false };
    state.runs[date] = run;
    const deliver = async (report) => {
      if (sendReport) {
        run.delivery = 'sending';
        await store.save(state);
        try {
          const delivery = await sendReport(buildDailyMessage(report));
          run.delivery = 'sent';
          run.message_id = delivery.message_id;
        } catch {
          run.delivery = 'uncertain';
          await store.save(state);
          throw new Error('report_delivery_uncertain');
        }
      } else run.delivery = 'disabled';
      run.status = 'complete';
      await store.save(state);
      return report;
    };
    if (run.report) return await deliver(run.report);
    await store.save(state);
    let sourceData;
    try { sourceData = await collect(); }
    catch { sourceData = { candidates: [], sources: [{ id: 'configured', status: 'failed', count: 0 }] }; }
    if (!Array.isArray(sourceData.candidates) || !Array.isArray(sourceData.sources)) throw new Error('collection_result_invalid');
    for (const candidate of sourceData.candidates) {
      const identity = sourceIdentity(candidate);
      if (!identity) continue;
      const key = createHash('sha256').update(identity).digest('hex');
      if (!state.items[key]) state.items[key] = { candidate, first_seen: now.toISOString() };
    }
    // AI 실패·한도 초과 원문은 항목별로 보존하고 다음 날짜에 다시 검토한다.
    const pending = Object.entries(state.items).filter(([, item]) => !item.finished && !item.analysis);
    const hasEligible = pending.some(([, item]) => inspectCandidate(item.candidate, { now }).ai_allowed);
    let analyzer = null;
    let aiDeferred = false;
    if (hasEligible && run.ai_attempted) aiDeferred = true;
    if (hasEligible && !run.ai_attempted) {
      // 네트워크 호출보다 먼저 기록한다. 강제 종료 후에도 같은 날 분석을 다시 호출하지 않는다.
      run.ai_attempted = true;
      await store.save(state);
      try { analyzer = await analyzerFactory(); }
      catch { run.ai_unavailable = true; }
    }
    const report = await runCollection(pending.map(([, item]) => item.candidate), { analyzer, existing, now });
    for (const record of report.records) {
      const item = state.items[pending[record.index][0]];
      item.disposition = record.disposition;
      item.reasons = record.quality.reasons;
      if (record.analysis?.analysis_status === 'ai_analyzed') { item.analysis = record.analysis; item.plan = record.plan; }
      if (['duplicate', 'excluded'].includes(record.disposition)) item.finished = true;
    }
    const failed = sourceData.sources.some((s) => s.status === 'failed');
    Object.assign(report, { date, sources: sourceData.sources, source_input_count: sourceData.candidates.length,
      ai_deferred: aiDeferred, ai_usage: analyzer?.usage || null,
      status: sourceData.sources.length === 0 ? 'source_not_configured'
        : failed || run.ai_unavailable || (report.counts.ai_requested > report.counts.ai_analyzed) ? 'partial' : 'ok' });
    run.report = report;
    await store.save(state);
    return await deliver(report);
  } finally { await store.release(); }
}
