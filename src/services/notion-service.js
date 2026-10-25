/**
 * notion-service.js
 * 분석된 Problem을 Notion DB에 저장하고 조회한다
 */

import { Client } from '@notionhq/client';
import { sourceIdentity, sourceKeys, restrictedSource } from '../utils/candidate-policy.js';
import { planStorage } from './collection-pipeline.js';

class NotionService {
  constructor({ client, problemDbId } = {}) {
    if (client && problemDbId) {
      this.client = client;
      this.problemDbId = problemDbId;
      return;
    }
    if (!process.env.NOTION_TOKEN) {
      throw new Error('NOTION_TOKEN이 .env에 없습니다.');
    }
    if (!process.env.NOTION_PROBLEM_DB_ID) {
      throw new Error(
        'NOTION_PROBLEM_DB_ID가 .env에 없습니다.\n' +
        'node scripts/setup-notion.js 를 먼저 실행하세요.'
      );
    }
    this.client = new Client({ auth: process.env.NOTION_TOKEN, logger: () => {} });
    this.problemDbId = process.env.NOTION_PROBLEM_DB_ID;
  }

  /**
   * Problem 저장
   * @param {Object} problem - AI 분석 결과
   * @returns {Object} 생성된 Notion 페이지
   */
  async saveProblem(problem) {
    if (restrictedSource(problem)) throw new Error('당근 자료는 서면 허용 범위 확인 전 자동 저장하지 않습니다.');
    if (problem.analysis_status !== 'ai_analyzed') throw new Error('AI 분석되지 않은 후보는 자동 저장하지 않습니다.');
    // 원문 단위 ID로 중복을 막는다. 서로 다른 원문이 같은 URL을 쓸 수 있어 URL만
    // 기준으로 삼으면 서로 다른 원문이 하나로 합쳐질 수 있다.
    const sourceItemId = sourceIdentity(problem);
    if (!sourceItemId) throw new Error('원문 식별자가 없습니다.');
    if (sourceItemId) {
      const existing = await this.findBySourceItemId(sourceItemId);
      if (existing) {
        return { skipped: true, id: existing.id };
      }
    }

    const existingProblems = await this.getAllProblems();
    const plan = planStorage(problem, existingProblems);
    if (plan.action !== 'create_candidate') return { skipped: true, review_required: plan.action === 'review_evidence_match', ...plan };
    const schema = await this.getSchema();

    const props = {
      '문제': {
        title: [{ text: { content: problem.problem_summary || '(요약 없음)' } }],
      },
    };

    if (schema['점수'] && problem.score != null)
      props['점수'] = { number: Number(problem.score) };
    if (schema['카테고리'] && problem.problem_category)
      props['카테고리'] = { select: { name: problem.problem_category } };
    if (problem.target_user)
      props['대상'] = { rich_text: [{ text: { content: problem.target_user } }] };
    if (problem.source_url)
      props['원문링크'] = { url: problem.source_url };
    props['상태'] = { select: { name: '수집됨' } };
    props['원문ID'] = { rich_text: [{ text: { content: sourceItemId } }] };
    if (problem.evidence_type)
      props['근거 유형'] = { select: { name: problem.evidence_type } };
    props['동일 문제 증거수'] = { number: 0 };
    if (schema['플랫폼']) props['플랫폼'] = { select: { name: problem.source_evidence_state === 'self_report' ? '직접 경험' : '기타' } };

    const date = problem.collected_at || new Date().toISOString();
    props['수집일'] = { date: { start: date.split('T')[0] } };

    // 조회한 기존 DB 속성만 사용한다. 운영 DB 스키마를 자동 변경하지 않는다.
    const properties = Object.fromEntries(Object.entries(props).filter(([name]) => schema[name]));
    const page = await this.client.pages.create({
      parent: { database_id: this.problemDbId },
      properties,
      children: buildProblemBlocks(problem),
    });

    return page;
  }

  // 사용자가 같은 문제임을 확인한 뒤에만 본문에 원문 후보를 추가한다.
  // 독립 실패 증거수는 갱신하지 않는다. 실운영 호출/승인은 별도 단계다.
  async appendEvidenceCandidate(pageId, candidate, review = {}) {
    if (!review.approved || !review.same_problem || !review.reviewed_by || !review.reviewed_at) {
      throw new Error('증거 후보 추가에는 사용자 문제 일치 판정과 승인이 필요합니다.');
    }
    if (restrictedSource(candidate)) throw new Error('당근 자료 자동 저장은 서면 허용 범위 확인이 필요합니다.');
    if (!candidate.source_url || candidate.original_verified !== true) throw new Error('직접 확인한 원문 URL이 필요합니다.');
    const identity = sourceIdentity(candidate);
    const page = await this.client.pages.retrieve({ page_id: pageId });
    if (page.parent?.database_id?.replace(/-/g, '') !== this.problemDbId.replace(/-/g, '')) throw new Error('문제 수집함에 속한 페이지가 아닙니다.');
    const primary = extractProblemFromPage(page);
    if (sourceKeys(primary).some((key) => sourceKeys(candidate).includes(key))) return { skipped: true, id: pageId };
    const marker = `증거 후보 원문ID: ${identity}`;
    let cursor;
    do {
      const response = await this.client.blocks.children.list({ block_id: pageId, start_cursor: cursor, page_size: 100 });
      if (response.results.some((block) => (block[block.type]?.rich_text || []).map((r) => r.plain_text || r.text?.content || '').join('') === marker)) {
        return { skipped: true, id: pageId };
      }
      cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);
    await this.client.blocks.children.append({ block_id: pageId, children: [
      { object: 'block', type: 'paragraph', paragraph: { rich_text: richText(marker) } },
      { object: 'block', type: 'paragraph', paragraph: { rich_text: richText(`사람 검토: ${review.reviewed_by} / ${review.reviewed_at}. 같은 문제 후보. 독립 사건·실패 여부와 증거수는 별도 확인.`) } },
      ...buildProblemBlocks({ ...candidate, source_evidence_state: 'human_checked_candidate' }),
    ] });
    return { id: pageId, appended: true, evidence_count_changed: false };
  }

  /**
   * 여러 문제 배치 저장
   * @param {Array} problems
   * @param {number} minScore - 이 점수 이상만 저장
   */
  async saveAll(problems) {
    let saved = 0;
    let skipped = 0;
    let failed = 0;

    console.log(`💾 Notion 저장 시작: ${problems.length}건 (점수는 저장 탈락 조건이 아님)`);

    for (const problem of problems) {
      // 규칙 점수만 있는 후보는 사업 문제로 저장하지 않는다.
      if (problem.analysis_status !== 'ai_analyzed') {
        skipped++;
        continue;
      }

      try {
        const result = await this.saveProblem(problem);
        if (result.skipped) {
          console.log('  ⏭️  중복 또는 기존 증거 일치 검토');
          skipped++;
        } else {
          console.log('  ✅ 후보 저장됨');
          saved++;
        }
      } catch (err) {
        console.error('  ❌ 저장 실패 — 연결·권한·스키마 확인 필요');
        failed++;
      }

      await sleep(300); // Notion API 제한
    }

    console.log(`\n💾 저장 완료: 성공 ${saved}건, 스킵 ${skipped}건, 실패 ${failed}건`);
    return { saved, skipped, failed };
  }

  /**
   * URL로 기존 항목 검색 (중복 방지용)
   */
  async findBySourceItemId(sourceItemId) {
    try {
      const response = await this.client.databases.query({
        database_id: this.problemDbId,
        filter: { property: '원문ID', rich_text: { equals: sourceItemId } },
        page_size: 1,
      });
      return response.results[0] || null;
    } catch {
      throw new Error('Notion 중복 조회 실패 — 중복 생성을 막기 위해 저장을 중단합니다.');
    }
  }

  async getSchema() {
    const database = await this.client.databases.retrieve({ database_id: this.problemDbId });
    for (const name of ['문제', '상태', '원문ID', '동일 문제 증거수']) {
      if (!database.properties[name]) throw new Error(`Notion 필수 속성 누락: ${name}`);
    }
    return database.properties;
  }

  async getAllProblems({ includeEvidence = true } = {}) {
    const results = [];
    let cursor;
    do {
      const response = await this.client.databases.query({ database_id: this.problemDbId, page_size: 100, start_cursor: cursor });
      results.push(...response.results.map(extractProblemFromPage));
      cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);
    if (includeEvidence && this.client.blocks?.children?.list) {
      for (const problem of results) {
        problem.evidence_source_ids = [];
        problem.known_source_keys = [];
        let blockCursor;
        do {
          const response = await this.client.blocks.children.list({ block_id: problem.id, page_size: 100, start_cursor: blockCursor });
          for (const block of response.results) {
            const text = (block[block.type]?.rich_text || []).map((r) => r.plain_text || r.text?.content || '').join('');
            if (text.startsWith('증거 후보 원문ID: ')) problem.evidence_source_ids.push(text.slice('증거 후보 원문ID: '.length));
            if (text.startsWith('중복 확인키: ')) problem.known_source_keys.push(text.slice('중복 확인키: '.length));
          }
          blockCursor = response.has_more ? response.next_cursor : undefined;
        } while (blockCursor);
      }
    }
    return results;
  }

  async getTopProblems(limit = 10, status = null) {
    const filter = status
      ? { property: '상태', select: { equals: status } }
      : undefined;

    const schema = await this.getSchema();
    const response = await this.client.databases.query({
      database_id: this.problemDbId,
      filter,
      sorts: [{ property: schema['점수'] ? '점수' : '수집일', direction: 'descending' }],
      page_size: Math.max(1, Math.min(100, Number(limit) || 10)),
    });

    return response.results.map(extractProblemFromPage);
  }

  async getTodayProblems() {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
    const schema = await this.getSchema();
    const response = await this.client.databases.query({
      database_id: this.problemDbId,
      filter: { property: '수집일', date: { equals: today } },
      sorts: [{ property: schema['점수'] ? '점수' : '수집일', direction: 'descending' }],
    });
    return response.results.map(extractProblemFromPage);
  }

  async updateStatus(pageId, status) {
    await this.client.pages.update({
      page_id: pageId,
      properties: { '상태': { select: { name: status } } },
    });
  }
}

function extractProblemFromPage(page) {
  const props = page.properties;
  const get = (name, type) => {
    const p = props[name];
    if (!p) return null;
    if (type === 'title') return p.title?.[0]?.plain_text || null;
    if (type === 'rich_text') return p.rich_text?.[0]?.plain_text || null;
    if (type === 'number') return p.number;
    if (type === 'select') return p.select?.name || null;
    if (type === 'url') return p.url;
    if (type === 'checkbox') return p.checkbox;
    if (type === 'date') return p.date?.start || null;
    return null;
  };

  return {
    id: page.id,
    notion_url: page.url,
    problem_summary: get('문제', 'title'),
    source: null,
    source_url: get('원문링크', 'url'),
    source_item_id: get('원문ID', 'rich_text'),
    evidence_count: get('동일 문제 증거수', 'number'),
    target_user: get('대상', 'rich_text'),
    problem_category: null,
    score: get('점수', 'number'),
    status: get('상태', 'select'),
    collected_at: get('수집일', 'date'),
  };
}

function buildProblemBlocks(problem) {
  const blocks = [];
  const addHeading = (text) => blocks.push({
    object: 'block', type: 'heading_2', heading_2: { rich_text: richText(text) },
  });
  const addParagraph = (label, value) => {
    if (!value) return;
    blocks.push({
      object: 'block', type: 'paragraph', paragraph: { rich_text: richText(`${label}: ${value}`) },
    });
  };

  addHeading('원문 근거');
  if (problem.evidence_quote) {
    blocks.push({
      object: 'block', type: 'quote', quote: { rich_text: richText(problem.evidence_quote) },
    });
  }
  if (problem.source_url) {
    blocks.push({
      object: 'block', type: 'paragraph', paragraph: {
        rich_text: [{ type: 'text', text: { content: '원문 링크', link: { url: problem.source_url } } }],
      },
    });
  }
  addParagraph('원문', problem.original_text);
  addParagraph('게시일 (입력 메타데이터)', problem.published_at);
  addParagraph('자료 확인 상태', problem.source_evidence_state);
  for (const key of sourceKeys(problem).filter((key) => /^(text|event):/.test(key))) addParagraph('중복 확인키', key);

  addHeading('AI 추론 — 원문 확인 사실과 구분');
  addParagraph('검토 분류', problem.review_disposition);
  addParagraph('정렬 점수 (수요·지불 의사 증거 아님)', problem.score);
  addParagraph('출처', problem.source);
  addParagraph('카테고리', problem.problem_category);
  addParagraph('신뢰도', problem.confidence);
  addParagraph('문제군', problem.problem_group);
  addParagraph('유사 후보 수', problem.similar_candidate_count);
  addParagraph('현재 해결 방식', problem.current_solution);
  addParagraph('해결 공백', problem.solution_gap);
  addParagraph('비용을 떠안는 역할', problem.cost_bearer);
  addParagraph('가능한 지불 주체', problem.potential_payer);
  addParagraph('근거 부족', problem.evidence_gaps?.join(' / '));

  addHeading('검증');
  addParagraph('검증 질문', problem.validation_question);
  addParagraph('증거 처리', '자동 증거수 0. 기존 문제와 유사하면 별도 생성 대신 사람의 사건 판독을 요청함. 승격은 사용자 결정.');

  return blocks;
}

function richText(content) {
  const safe = String(content);
  return Array.from({ length: Math.ceil(safe.length / 1900) }, (_, index) => ({ type: 'text', text: { content: safe.slice(index * 1900, (index + 1) * 1900) } }));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export default NotionService;
