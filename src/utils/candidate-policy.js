import { createHash } from 'node:crypto';

export const DAANGN_CAFES = ['x6idgz', 'sajangnimdeulkk', 'jayeong-eob-gom'];
const digest = (text) => createHash('sha256').update(text).digest('hex');
const normalize = (text = '') => typeof text === 'string' ? text.normalize('NFKC').replace(/\s+/g, ' ').trim() : '';

export function canonicalUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_|^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.href;
  } catch { return null; }
}

// 원문, URL, 사람이 식별한 작성자·사건만 사용한다. 제목·AI 유사도는 중복 키가 아니다.
export function sourceKeys(candidate) {
  const keys = [];
  const url = canonicalUrl(candidate.source_url);
  if (url) keys.push(`url:${url}`);
  if (candidate.source_item_id) keys.push(`id:${candidate.source_item_id}`);
  for (const id of candidate.evidence_source_ids || []) keys.push(`id:${id}`);
  for (const key of candidate.known_source_keys || []) {
    if (/^(event|text):[a-f0-9]{64}$/.test(key)) keys.push(key);
  }
  if (candidate.author_key && candidate.event_key) {
    keys.push(`event:${digest(`${candidate.source || ''}|${candidate.author_key}|${candidate.event_key}`)}`);
  }
  // 출처가 다른 동일 문구는 독립 증거로 세지 않고 복제 의심으로 검토한다.
  if (normalize(candidate.original_text)) keys.push(`text:${digest(normalize(candidate.original_text))}`);
  return keys;
}

export function sourceIdentity(candidate) {
  const url = canonicalUrl(candidate.source_url);
  if (url) return `url:${url}`;
  return candidate.source_item_id || sourceKeys(candidate)[0] || null;
}

export function restrictedSource(candidate) {
  const text = `${candidate.source_url || ''} ${candidate.original_text || ''} ${candidate.source || ''}`;
  return /(?:https?:\/\/)?(?:[a-z0-9-]+\.)?daangn\.com\b|당근\s*(?:카페|동네생활)/i.test(text);
}

export function inspectCandidate(candidate, { now = new Date(), recentDays = 7 } = {}) {
  const reasons = [];
  if (!candidate || typeof candidate.original_text !== 'string' || !candidate.original_text.trim()) {
    return { disposition: 'excluded', reasons: ['empty_text'], ai_allowed: false };
  }
  // 당근 자동 수집/AI 데이터 마이닝은 서면 허용 범위를 확인하기 전까지 비활성.
  if (restrictedSource(candidate)) {
    return { disposition: 'permission_required', reasons: ['daangn_written_permission_required'], ai_allowed: false };
  }
  if (candidate.access === 'blocked' || candidate.access === 'login_required') {
    return { disposition: 'inaccessible', reasons: ['original_not_accessible'], ai_allowed: false };
  }
  if (['advertisement', 'operator', 'general', 'repost'].includes(candidate.record_type)) {
    return { disposition: 'excluded', reasons: [`record_type:${candidate.record_type}`], ai_allowed: false };
  }
  if (candidate.record_type === 'recovery') reasons.push('recovery_not_failure');
  if (candidate.source_url && !canonicalUrl(candidate.source_url)) reasons.push('invalid_url');
  if (candidate.evidence_state !== 'self_report') {
    if (!candidate.source_url) reasons.push('missing_url');
    if (candidate.original_verified !== true) reasons.push('original_unverified');
    if (!candidate.author_key) reasons.push('author_unknown');
    const published = candidate.published_at;
    const date = typeof published === 'string' && /^\d{4}-\d{2}-\d{2}(T.*(?:Z|[+-]\d{2}:\d{2}))?$/.test(published)
      ? new Date(published.length === 10 ? `${published}T00:00:00+09:00` : published) : null;
    const datePart = typeof published === 'string' ? published.slice(0, 10) : '';
    const calendarDate = /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? new Date(`${datePart}T00:00:00Z`) : null;
    const validCalendar = calendarDate && Number.isFinite(calendarDate.getTime()) && calendarDate.toISOString().slice(0, 10) === datePart;
    if (!date || !validCalendar || !Number.isFinite(date.getTime()) || candidate.date_verified !== true) reasons.push('date_unverified');
    else if (date > now) reasons.push('future_date');
    else if (now - date > recentDays * 86400000) {
      return { disposition: 'excluded', reasons: ['outside_7_days'], ai_allowed: false };
    }
  }
  if (candidate.original_text.length > 12000) reasons.push('text_over_limit_manual_review');
  const disposition = reasons.length ? 'needs_research' : 'eligible';
  return { disposition, reasons, ai_allowed: disposition === 'eligible' };
}

export function validationEligibility(problem) {
  // 이 값들은 원문 판독 후 사람이 전달하는 확인값이다. 수집 AI 출력에서는 받지 않는다.
  const confirmed = problem.human_review;
  if (!confirmed?.reviewed_by || !confirmed?.reviewed_at) return false;
  return (Number(confirmed.independent_failure_count) >= 3)
    || ((confirmed.current_spend === true || confirmed.repeated_action === true)
      && confirmed.accessible_customer === true);
}

export function analysisDisposition(analysis) {
  if (analysis.analysis_status !== 'ai_analyzed') return 'needs_research';
  if (analysis.evidence_type === '단순 불만') return 'excluded';
  if (!analysis.evidence_quote || analysis.evidence_type === '정보 부족'
    || analysis.is_estimated || !analysis.cost_bearer || analysis.cost_bearer === '미확인') return 'needs_research';
  // 점수가 낮아도 자료를 없애거나 기각하지 않는다.
  return 'candidate';
}
