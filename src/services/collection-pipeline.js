import { FREE_TIER_AI_LIMIT } from '../config/index.js';
import { inspectCandidate, sourceKeys, sourceIdentity, analysisDisposition } from '../utils/candidate-policy.js';

export function planStorage(problem, existing = []) {
  const keys = sourceKeys(problem);
  const duplicate = existing.find((item) => sourceKeys(item).some((key) => keys.includes(key)));
  if (duplicate) return { action: 'skip_duplicate', target_id: duplicate.id || null };
  // 의미가 같다는 이유로 합치거나 증거를 늘리지 않는다. 사람의 사건 판독을 요청한다.
  const compact = (s = '') => s.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  const tokens = (s) => new Set(Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2)));
  const similar = (a, b) => {
    const left = tokens(compact(a)); const right = tokens(compact(b));
    const intersection = [...left].filter((t) => right.has(t)).length;
    return intersection / (left.size + right.size - intersection || 1) >= 0.32;
  };
  const matches = existing.filter((item) => similar(problem.problem_summary, item.problem_summary));
  if (matches.length) return { action: 'review_evidence_match', target_ids: matches.map((x) => x.id), reason: 'human_event_review_required' };
  return { action: 'create_candidate', evidence_count: 0 };
}

// 기본은 로컬 판정만 한다. 외부 읽기·AI·Notion 쓰기는 호출자가 명시적으로 주입한다.
export async function runCollection(candidates, { analyzer = null, existing = [], now = new Date() } = {}) {
  if (!Array.isArray(candidates)) throw new Error('입력은 원문 객체의 JSON 배열이어야 합니다.');
  const seen = new Map();
  const records = candidates.map((input, index) => {
    const candidate = { ...input, source_item_id: input?.source_item_id || sourceIdentity(input || {}) };
    const quality = inspectCandidate(input, { now });
    const keys = sourceKeys(candidate);
    const duplicateKey = keys.find((key) => seen.has(key));
    // 기존 Notion 중복도 AI 호출 전에 제외한다.
    const old = existing.find((item) => sourceKeys(item).some((key) => keys.includes(key)));
    const representative = duplicateKey ? seen.get(duplicateKey) : old?.id ?? index;
    for (const key of keys) seen.set(key, representative);
    return { index, candidate, quality, duplicate_of: duplicateKey ? seen.get(duplicateKey) : old?.id ?? null,
      disposition: duplicateKey || old ? 'duplicate' : quality.disposition };
  });
  const targets = records.filter((r) => r.disposition === 'eligible').slice(0, FREE_TIER_AI_LIMIT);
  if (analyzer && targets.length) {
    let analyses;
    try {
      analyses = await analyzer.analyzeAll(targets.map((r) => r.candidate), { allowIndividualFallback: false });
    } catch {
      analyses = [];
    }
    // 분석 결과는 원문 ID에 대응시킨다. 누락/파싱 실패를 조용히 삭제하지 않는다.
    for (const record of targets) {
      record.analysis = analyses.find((a) => a.source_item_id === record.candidate.source_item_id);
      record.disposition = record.analysis ? analysisDisposition(record.analysis) : 'needs_research';
      if (!record.analysis) record.quality.reasons.push('analysis_unavailable');
    }
    for (const record of records.filter((r) => r.disposition === 'eligible' && !targets.includes(r))) {
      record.disposition = 'needs_research';
      record.quality.reasons.push('ai_budget_deferred');
    }
  }
  const planned = [...existing];
  for (const record of records) {
    if (record.disposition === 'duplicate') record.plan = { action: 'skip_duplicate' };
    else if (record.disposition === 'excluded') record.plan = { action: 'hold', reason: record.quality.reasons[0] || 'simple_complaint' };
    else if (record.analysis?.analysis_status === 'ai_analyzed') {
      record.plan = planStorage(record.analysis, planned);
      if (record.plan.action === 'create_candidate') planned.push({ ...record.analysis, id: `batch:${record.index}` });
    } else record.plan = { action: 'hold', reason: record.quality.reasons[0] || (analyzer ? 'ai_budget_or_unavailable' : 'analysis_not_requested') };
  }
  const counts = { input: records.length, unique: records.filter((r) => r.disposition !== 'duplicate').length,
    ai_requested: analyzer ? targets.length : 0, ai_analyzed: records.filter((r) => r.analysis?.analysis_status === 'ai_analyzed').length };
  for (const r of records) counts[r.disposition] = (counts[r.disposition] || 0) + 1;
  const reason_counts = {};
  for (const r of records) for (const reason of r.quality.reasons) reason_counts[reason] = (reason_counts[reason] || 0) + 1;
  return { version: 1, mode: 'dry_run', generated_at: now.toISOString(), counts, reason_counts, records };
}
