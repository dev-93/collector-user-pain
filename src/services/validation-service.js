/**
 * validation-service.js
 * 사업 검증 실험실 (Validation Lab) Notion DB와 상호작용
 *
 * 검증 흐름:
 *   수집된 문제 → AI 분석 → 검증 가설 자동 생성 → Notion 검증 DB 저장
 *   → 실제 검증 실행 (회장님 직접) → 결과 업데이트 → Go/Pivot/Kill 결정
 */

import { Client } from '@notionhq/client';
import { VALIDATION_PLAYBOOKS } from '../config/validation-playbooks.js';

class ValidationService {
  constructor() {
    if (!process.env.NOTION_TOKEN) {
      throw new Error('NOTION_TOKEN이 .env에 없습니다.');
    }
    if (!process.env.NOTION_VALIDATION_DB_ID) {
      throw new Error(
        'NOTION_VALIDATION_DB_ID가 .env에 없습니다.\n' +
        'node scripts/setup-validation-db.js 를 먼저 실행하세요.'
      );
    }
    this.client = new Client({ auth: process.env.NOTION_TOKEN });
    this.validationDbId = process.env.NOTION_VALIDATION_DB_ID;
    this.problemDbId = process.env.NOTION_PROBLEM_DB_ID;
  }

  /**
   * 수집된 문제로부터 자동으로 검증 실험 가설 생성
   * @param {Object} problem - Notion Problem DB 페이지 (id 필수)
   * @param {string} playbookId - validation-playbooks.js의 id
   * @returns {Object} 생성된 Notion 검증 페이지
   */
  async createValidationExperiment(problem, playbookId = 'community-smoke-test') {
    const playbook = VALIDATION_PLAYBOOKS.find((p) => p.id === playbookId)
      || VALIDATION_PLAYBOOKS[0];

    const hypothesisName = `[${playbook.name.split('.')[0].trim()}] ${problem.problem_summary || '문제 검증'}`;

    const props = {
      '실험명': {
        title: [{ text: { content: hypothesisName } }],
      },
      '실험 방법': {
        select: { name: playbook.name },
      },
      '채널': {
        select: { name: playbook.channel.split('/')[0].trim() },
      },
      '상태': {
        status: { name: '가설 수립' },
      },
      '성공 기준': {
        rich_text: [{ text: { content: playbook.passCriteria } }],
      },
      '학습': {
        rich_text: [{
          text: {
            content: `📋 실행 가이드:\n${playbook.actionSteps.join('\n')}\n\n⏱ 예상 소요: ${playbook.duration}`,
          },
        }],
      },
      '시작일': {
        date: { start: new Date().toISOString().split('T')[0] },
      },
      // 검증 진입 이유: 왜 수집함에서 검증 실험실로 올라왔는가
      '검증 진입 이유': {
        rich_text: [{ text: { content: problem.validation_reason || '' } }],
      },
      // 비용 부담자: 이 문제가 지속될 때 실제 시간·돈을 부담하는 주체
      '비용 부담자': {
        rich_text: [{ text: { content: problem.payer || '' } }],
      },
    };

    // Problem DB Relation 연결
    if (problem.id && this.problemDbId) {
      props['문제'] = {
        relation: [{ id: problem.id }],
      };
    }

    const page = await this.client.pages.create({
      parent: { database_id: this.validationDbId },
      properties: props,
    });

    return page;
  }

  /**
   * 문제 카테고리/점수 기반 최적 플레이북 자동 추천
   * @param {Object} problem
   * @returns {string} playbookId
   */
  recommendPlaybook(problem) {
    const category = problem.problem_category || '';
    const score = problem.score || 0;

    if (score >= 80) return 'fake-door-waitlist';
    if (['직장/업무', '반복 작업', '행정/서류'].includes(category)) return 'community-smoke-test';
    if (['예약/스케줄', '이동/물류', '비교/선택'].includes(category)) return 'concierge-mvp';
    return 'the-mom-test';
  }

  /**
   * 검증 결과 업데이트
   * @param {string} pageId - Notion 검증 페이지 ID
   * @param {Object} result - { status, actualResult, learnings }
   */
  async updateResult(pageId, result) {
    const props = {};
    if (result.status) props['상태'] = { status: { name: result.status } };
    if (result.actualResult) {
      props['실제 결과'] = {
        rich_text: [{ text: { content: result.actualResult } }],
      };
    }
    if (result.learnings) {
      props['학습'] = {
        rich_text: [{ text: { content: result.learnings } }],
      };
    }
    await this.client.pages.update({ page_id: pageId, properties: props });
  }

  /**
   * 현재 진행 중인 검증 실험 목록
   */
  async getActiveExperiments() {
    const response = await this.client.databases.query({
      database_id: this.validationDbId,
      filter: {
        or: [
          { property: '상태', status: { equals: '가설 수립' } },
          { property: '상태', status: { equals: '실험 진행중' } },
        ],
      },
      sorts: [{ property: '시작일', direction: 'descending' }],
    });
    return response.results.map(extractValidationFromPage);
  }

  /**
   * 검증 완료 통계
   */
  async getStats() {
    const response = await this.client.databases.query({
      database_id: this.validationDbId,
    });
    const stats = { total: 0, go: 0, pivot: 0, kill: 0, inProgress: 0 };
    for (const page of response.results) {
      const status = page.properties.status?.status?.name || '';
      stats.total++;
      if (status.includes('Go')) stats.go++;
      else if (status.includes('Pivot')) stats.pivot++;
      else if (status.includes('Kill')) stats.kill++;
      else stats.inProgress++;
    }
    return stats;
  }

  /**
   * TOP 문제에 대해 검증 실험 일괄 자동 생성
   * @param {Array} problems - NotionService.getTopProblems() 결과
   * @param {number} limit - 최대 생성 건수
   */
  async autoCreateFromProblems(problems, limit = 5) {
    const topProblems = problems
      .filter((p) => p.score >= 70 && p.status === '수집됨')
      .slice(0, limit);

    if (topProblems.length === 0) {
      console.log('  📭 검증 대상 문제가 없습니다. (score 70+ 문제를 먼저 수집하세요)');
      return [];
    }

    console.log(`\n🧪 검증 가설 자동 생성: ${topProblems.length}건`);
    const created = [];

    for (const problem of topProblems) {
      const playbookId = this.recommendPlaybook(problem);
      const playbook = VALIDATION_PLAYBOOKS.find((p) => p.id === playbookId);

      try {
        const page = await this.createValidationExperiment(problem, playbookId);
        console.log(`  ✅ [${problem.score}점] ${problem.problem_summary}`);
        console.log(`     추천 플레이북: ${playbook?.name}`);
        console.log(`     Notion: ${page.url}`);
        created.push(page);
      } catch (err) {
        console.error(`  ❌ 생성 실패: ${problem.problem_summary}`, err.message);
      }

      await sleep(300);
    }

    return created;
  }
}

function extractValidationFromPage(page) {
  const props = page.properties;
  const get = (name, type) => {
    const p = props[name];
    if (!p) return null;
    if (type === 'title') return p.title?.[0]?.plain_text || null;
    if (type === 'rich_text') return p.rich_text?.[0]?.plain_text || null;
    if (type === 'select') return p.select?.name || null;
    if (type === 'status') return p.status?.name || null;
    if (type === 'date') return p.date?.start || null;
    return null;
  };
  return {
    id: page.id,
    notion_url: page.url,
    name: get('실험명', 'title'),
    method: get('실험 방법', 'select'),
    channel: get('채널', 'select'),
    status: get('상태', 'status'),
    target_metric: get('성공 기준', 'rich_text'),
    actual_result: get('실제 결과', 'rich_text'),
    learnings: get('학습', 'rich_text'),
    start_date: get('시작일', 'date'),
    validation_reason: get('검증 진입 이유', 'rich_text'),
    payer: get('비용 부담자', 'rich_text'),
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export default ValidationService;
