import { readFile } from 'node:fs/promises';

const RESTRICTED = /(^|\.)(daangn\.com|reddit\.com|redd\.it|bbb\.org|airbnb\.[a-z.]+|trustpilot\.com)$/i;

// 설정 파일은 운영자가 검토한 출처만 등록한다. 공개 URL이나 API 존재는 이용 허가가 아니다.
export function validateSources(sources) {
  if (!Array.isArray(sources) || sources.length > 5) throw new Error('sources_invalid');
  const ids = new Set();
  for (const source of sources) {
    if (!source || !/^[a-z0-9-]{1,60}$/.test(source.id || '') || ids.has(source.id)) throw new Error('source_id_invalid');
    ids.add(source.id);
    if (source.type !== 'json' || !source.permission?.reviewed_by || !source.permission?.reviewed_at
      || !source.permission?.reference || source.permission.automated_read !== true
      || source.permission.ai_analysis !== true || source.permission.retention !== true) throw new Error('source_permission_missing');
    const url = new URL(source.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search
      || RESTRICTED.test(url.hostname) || url.hostname === 'localhost'
      || /^[\d.:\[\]]+$/.test(url.hostname) || url.hostname.endsWith('.local')) throw new Error('source_url_not_allowed');
  }
  return sources;
}

export async function loadSourceConfig(path) {
  return validateSources(JSON.parse(await readFile(path, 'utf8')));
}

export async function collectSources(sources, { fetchImpl = fetch, maxBytes = 1000000 } = {}) {
  validateSources(sources);
  const candidates = [];
  const results = [];
  for (const source of sources) {
    try {
      const response = await fetchImpl(source.url, { redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('source_http_error');
      if (!/application\/(?:[a-z-]+\+)?json/i.test(response.headers.get('content-type') || '')) throw new Error('source_not_json');
      if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('source_too_large');
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > maxBytes) throw new Error('source_too_large');
        chunks.push(chunk);
      }
      const items = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!Array.isArray(items) || items.length > 100) throw new Error('source_items_invalid');
      for (const item of items) {
        if (!item || typeof item.original_text !== 'string' || item.original_text.length > 12000) throw new Error('source_item_invalid');
      }
      // 원문 확인값은 제공된 검토 자료를 유지한다. 자동 수집 자체로 사람이 확인했다고 표시하지 않는다.
      candidates.push(...items.map((item) => ({ ...item, source: source.id })));
      results.push({ id: source.id, status: 'ok', count: items.length });
    } catch {
      results.push({ id: source.id, status: 'failed', count: 0 });
    }
  }
  return { candidates, sources: results };
}
