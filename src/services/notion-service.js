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
    // 같은 URL이 이미 있으면 스킵 (중복 방지)
    if (problem.source_url) {
      const existing = await this.findByUrl(problem.source_url);
      if (existing) {
        return { skipped: true, id: existing.id };
      }
    }

    const props = {
      problem_summary: {
        title: [{ text: { content: problem.problem_summary || '(요약 없음)' } }],
      },
    };

    // 텍스트 필드
    if (problem.original_text) {
      props.original_text = {
        rich_text: [{ text: { content: problem.original_text.slice(0, 2000) } }],
      };
    }
    if (problem.target_user) {
      props.target_user = {
        rich_text: [{ text: { content: problem.target_user } }],
      };
    }
    if (problem.context) {
      props.context = {
        rich_text: [{ text: { content: problem.context } }],
      };
    }
    if (problem.current_solution) {
      props.current_solution = {
        rich_text: [{ text: { content: problem.current_solution } }],
      };
    }
    if (problem.solution_gap) {
      props.solution_gap = {
        rich_text: [{ text: { content: problem.solution_gap } }],
      };
    }
    if (problem.competitors) {
      props.competitors = {
        rich_text: [{ text: { content: problem.competitors } }],
      };
    }

    // URL
    if (problem.source_url) {
      props.source_url = { url: problem.source_url };
    }

    // Select 필드
    if (problem.source) {
      props.source = { select: { name: problem.source } };
    }
    if (problem.problem_category) {
      props.problem_category = { select: { name: problem.problem_category } };
    }
    if (problem.status) {
      props.status = { select: { name: problem.status } };
    }

    // 숫자 필드
    const numberFields = [
      'frequency', 'pain', 'willingness_to_pay',
      'market_size', 'competition_gap', 'my_fit',
      'development_difficulty', 'score',
    ];
    for (const field of numberFields) {
      if (problem[field] != null) {
        props[field] = { number: Number(problem[field]) };
      }
    }

    // 체크박스
    if (problem.is_estimated != null) {
      props.is_estimated = { checkbox: Boolean(problem.is_estimated) };
    }

    // 날짜
    const date = problem.collected_at || new Date().toISOString();
    props.collected_at = { date: { start: date.split('T')[0] } };

    // 메모 (MVP 아이디어 또는 기각 사유)
    const memo = problem.mvp_idea || problem.skip_reason || '';
    if (memo) {
      props.memo = { rich_text: [{ text: { content: memo.slice(0, 2000) } }] };
    }

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
  async findByUrl(url) {
    try {
      const response = await this.client.databases.query({
        database_id: this.problemDbId,
        filter: {
          property: 'source_url',
          url: { equals: url },
        },
        page_size: 1,
      });
      return response.results[0] || null;
    } catch {
      return null;
    }
  }

  /**
   * TOP N 문제 조회 (점수 내림차순)
   * @param {number} limit
   * @param {string} status - 특정 상태만 조회 (null이면 전체)
   */
  async getTopProblems(limit = 10, status = null) {
    const filter = status
      ? { property: 'status', select: { equals: status } }
      : undefined;

    const response = await this.client.databases.query({
      database_id: this.problemDbId,
      filter,
      sorts: [{ property: 'score', direction: 'descending' }],
      page_size: limit,
    });

    return response.results.map(extractProblemFromPage);
  }

  /**
   * 오늘 수집된 문제 조회
   */
  async getTodayProblems() {
    const today = new Date().toISOString().split('T')[0];

    const response = await this.client.databases.query({
      database_id: this.problemDbId,
      filter: {
        property: 'collected_at',
        date: { equals: today },
      },
      sorts: [{ property: 'score', direction: 'descending' }],
    });

    return response.results.map(extractProblemFromPage);
  }

  /**
   * 문제 상태 업데이트 (검증 중 → 검증완료 등)
   */
  async updateStatus(pageId, status) {
    await this.client.pages.update({
      page_id: pageId,
      properties: {
        status: { select: { name: status } },
      },
    });
  }
}

// Notion 페이지에서 Problem 구조체 추출
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
    problem_summary: get('problem_summary', 'title'),
    source: get('source', 'select'),
    source_url: get('source_url', 'url'),
    target_user: get('target_user', 'rich_text'),
    problem_category: get('problem_category', 'select'),
    frequency: get('frequency', 'number'),
    pain: get('pain', 'number'),
    willingness_to_pay: get('willingness_to_pay', 'number'),
    my_fit: get('my_fit', 'number'),
    score: get('score', 'number'),
    status: get('status', 'select'),
    is_estimated: get('is_estimated', 'checkbox'),
    collected_at: get('collected_at', 'date'),
    mvp_idea: get('memo', 'rich_text'),
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export default NotionService;
