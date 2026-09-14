/**
 * notion-service.js
 * 분석된 Problem을 Notion DB에 저장하고 조회한다
 */

import { Client } from '@notionhq/client';

class NotionService {
  constructor() {
    if (!process.env.NOTION_TOKEN) {
      throw new Error('NOTION_TOKEN이 .env에 없습니다.');
    }
    if (!process.env.NOTION_PROBLEM_DB_ID) {
      throw new Error(
        'NOTION_PROBLEM_DB_ID가 .env에 없습니다.\n' +
        'node scripts/setup-notion.js 를 먼저 실행하세요.'
      );
    }
    this.client = new Client({ auth: process.env.NOTION_TOKEN });
    this.problemDbId = process.env.NOTION_PROBLEM_DB_ID;
  }

  /**
   * Problem 저장
   * @param {Object} problem - AI 분석 결과
   * @returns {Object} 생성된 Notion 페이지
   */
  async saveProblem(problem) {
    // 원문 단위 ID로 중복을 막는다. 앱 리뷰는 앱 상세 URL이 같으므로 URL만
    // 기준으로 삼으면 같은 앱의 여러 리뷰가 모두 사라진다.
    const sourceItemId = problem.source_item_id || problem.source_url || hashText(problem.original_text);
    if (sourceItemId) {
      const existing = await this.findBySourceItemId(sourceItemId);
      if (existing) {
        return { skipped: true, id: existing.id };
      }
    }

    const props = {
      '문제': {
        title: [{ text: { content: problem.problem_summary || '(요약 없음)' } }],
      },
    };

    if (problem.score != null)
      props['점수'] = { number: Number(problem.score) };
    if (problem.problem_category)
      props['카테고리'] = { select: { name: problem.problem_category } };
    if (problem.target_user)
      props['대상'] = { rich_text: [{ text: { content: problem.target_user } }] };
    if (problem.source)
      props['출처'] = { select: { name: problem.source } };
    if (problem.source_url)
      props['원문링크'] = { url: problem.source_url };
    if (problem.status)
      props['상태'] = { select: { name: problem.status } };
    props['원문ID'] = { rich_text: [{ text: { content: sourceItemId } }] };
    if (problem.original_text)
      props['원문'] = { rich_text: [{ text: { content: problem.original_text.slice(0, 1800) } }] };
    if (problem.evidence_quote)
      props['근거 인용'] = { rich_text: [{ text: { content: problem.evidence_quote } }] };
    if (problem.evidence_type)
      props['근거 유형'] = { select: { name: problem.evidence_type } };
    if (problem.confidence)
      props['신뢰도'] = { select: { name: problem.confidence } };
    if (problem.validation_question)
      props['검증 질문'] = { rich_text: [{ text: { content: problem.validation_question } }] };
    if (problem.validation_offer)
      props['검증 제안'] = { rich_text: [{ text: { content: problem.validation_offer } }] };
    if (problem.current_solution)
      props['현재 해결 방식'] = { rich_text: [{ text: { content: problem.current_solution } }] };
    if (problem.solution_gap)
      props['해결 공백'] = { rich_text: [{ text: { content: problem.solution_gap } }] };
    if (problem.problem_group)
      props['문제군'] = { rich_text: [{ text: { content: problem.problem_group } }] };
    if (problem.evidence_count != null)
      props['동일 문제 증거수'] = { number: Number(problem.evidence_count) };
    if (problem.evidence_gaps?.length)
      props['근거 부족'] = { rich_text: [{ text: { content: problem.evidence_gaps.join(' / ') } }] };

    const date = problem.collected_at || new Date().toISOString();
    props['수집일'] = { date: { start: date.split('T')[0] } };

    const page = await this.client.pages.create({
      parent: { database_id: this.problemDbId },
      properties: props,
    });

    return page;
  }

  /**
   * 여러 문제 배치 저장
   * @param {Array} problems
   * @param {number} minScore - 이 점수 이상만 저장
   */
  async saveAll(problems, minScore = 50) {
    let saved = 0;
    let skipped = 0;
    let failed = 0;

    console.log(`💾 Notion 저장 시작: ${problems.length}건 (점수 ${minScore}+ 필터)`);

    for (const problem of problems) {
      // 규칙 점수만 있는 후보는 사업 문제로 저장하지 않는다.
      if (problem.analysis_status !== 'ai_analyzed') {
        skipped++;
        continue;
      }
      if ((problem.score || 0) < minScore) {
        skipped++;
        continue;
      }

      try {
        const result = await this.saveProblem(problem);
        if (result.skipped) {
          console.log(`  ⏭️  중복 스킵: ${problem.problem_summary}`);
          skipped++;
        } else {
          console.log(`  ✅ 저장됨: [${problem.score}점] ${problem.problem_summary}`);
          saved++;
        }
      } catch (err) {
        console.error(`  ❌ 저장 실패: ${problem.problem_summary}`, err.message);
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
      return null;
    }
  }

  async getTopProblems(limit = 10, status = null) {
    const filter = status
      ? { property: '상태', select: { equals: status } }
      : undefined;

    const response = await this.client.databases.query({
      database_id: this.problemDbId,
      filter,
      sorts: [{ property: '점수', direction: 'descending' }],
      page_size: limit,
    });

    return response.results.map(extractProblemFromPage);
  }

  async getTodayProblems() {
    const today = new Date().toISOString().split('T')[0];
    const response = await this.client.databases.query({
      database_id: this.problemDbId,
      filter: { property: '수집일', date: { equals: today } },
      sorts: [{ property: '점수', direction: 'descending' }],
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

function hashText(text = '') {
  return text ? `text:${text.trim().slice(0, 500)}` : null;
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
    source: get('출처', 'select'),
    source_url: get('원문링크', 'url'),
    target_user: get('대상', 'rich_text'),
    problem_category: get('카테고리', 'select'),
    score: get('점수', 'number'),
    status: get('상태', 'select'),
    collected_at: get('수집일', 'date'),
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export default NotionService;
