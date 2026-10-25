/**
 * telegram-bot.js
 * Problem Radar Telegram 봇 — 수집함 + 알림함 + 직접 제보 인터페이스
 *
 * 커맨드:
 *   /start     - 안내 메시지
 *   /collect   - 외부 자동 수집 비활성 안내
 *   /top       - TOP 10 문제 조회
 *   /today     - 오늘 수집된 문제 조회
 *   /why <번호> - 특정 문제 5 Why 분석
 *   /status    - 시스템 상태 확인
 *
 * 직접 제보:
 *   [문제] 텍스트로 시작하면 AI가 자동 구조화 + Notion 저장
 */

import TelegramBot from 'node-telegram-bot-api';
import AIAnalyzer from './ai-analyzer.js';
import NotionService from './notion-service.js';
import { runCollection } from './collection-pipeline.js';

const ALLOWED_CHAT_ID = process.env.TELEGRAM_CHAT_ID
  ? Number(process.env.TELEGRAM_CHAT_ID)
  : null;

class ProblemRadarBot {
  constructor() {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      throw new Error('TELEGRAM_BOT_TOKEN이 .env에 없습니다.');
    }
    if (!ALLOWED_CHAT_ID) throw new Error('TELEGRAM_CHAT_ID를 설정해야 제보를 받을 수 있습니다.');

    this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
    this.analyzer = new AIAnalyzer();
    this.notion = new NotionService();

    // 마지막 TOP 조회 결과 캐시 (/why 커맨드용)
    this._lastTopResults = [];
    this._reportQueue = Promise.resolve();

    this._registerHandlers();
    console.log('🤖 Telegram 봇 시작됨');
  }

  // 채팅 ID 인증 체크
  isAllowed(chatId) {
    if (!ALLOWED_CHAT_ID) return false;
    return chatId === ALLOWED_CHAT_ID;
  }

  _registerHandlers() {
    const bot = this.bot;

    // /start
    bot.onText(/\/start/, (msg) => {
      if (!this.isAllowed(msg.chat.id)) return;
      bot.sendMessage(msg.chat.id, HELP_TEXT, { parse_mode: 'Markdown' });
    });

    // /collect
    bot.onText(/\/collect/, async (msg) => {
      if (!this.isAllowed(msg.chat.id)) return;
      await this._handleCollect(msg.chat.id);
    });

    // /top [N]
    bot.onText(/\/top(?:\s+(\d+))?/, async (msg, match) => {
      if (!this.isAllowed(msg.chat.id)) return;
      const limit = parseInt(match[1]) || 10;
      await this._handleTop(msg.chat.id, limit);
    });

    // /today
    bot.onText(/\/today/, async (msg) => {
      if (!this.isAllowed(msg.chat.id)) return;
      await this._handleToday(msg.chat.id);
    });

    // /why <번호>
    bot.onText(/\/why(?:\s+(\d+))?/, async (msg, match) => {
      if (!this.isAllowed(msg.chat.id)) return;
      const index = parseInt(match[1]) || 1;
      await this._handleWhy(msg.chat.id, index);
    });

    // /status
    bot.onText(/\/status/, async (msg) => {
      if (!this.isAllowed(msg.chat.id)) return;
      await this._handleStatus(msg.chat.id);
    });

    // 직접 제보: "[문제]" 로 시작하는 메시지
    bot.on('message', async (msg) => {
      if (!this.isAllowed(msg.chat.id)) return;
      if (!msg.text) return;
      if (msg.text.startsWith('/')) return; // 커맨드 제외

      if (msg.text.startsWith('[문제]') || msg.text.startsWith('[제보]')) {
        this._reportQueue = this._reportQueue.then(() => this._handleDirectReport(msg.chat.id, msg.text)).catch(() => {
          console.error('제보 처리 실패 — 내용과 자격 증명은 로그에 기록하지 않습니다.');
        });
      }
    });

    bot.on('polling_error', (err) => {
      console.error('Telegram 폴링 실패 — 연결 설정을 확인하세요.');
    });
  }

  // /collect 핸들러
  async _handleCollect(chatId) {
    await this.bot.sendMessage(
      chatId,
      '⏸️ 외부 자동 수집은 비활성화되어 있습니다.\n\n확인한 원문·관찰을 `[문제]` 또는 `[제보]`로 직접 보내면 AI가 가설로 정리합니다.',
      { parse_mode: 'Markdown' }
    );
  }

  // /top 핸들러
  async _handleTop(chatId, limit) {
    await this.bot.sendMessage(chatId, `📊 TOP ${limit} 문제 조회 중...`);

    try {
      const problems = await this.notion.getTopProblems(limit);
      this._lastTopResults = problems;

      if (problems.length === 0) {
        await this.bot.sendMessage(chatId, '저장된 문제가 없습니다. [문제] 또는 [제보]로 직접 기록해 주세요.');
        return;
      }

      let message = `*🔥 TOP ${problems.length} 문제 (점수 순)*\n\n`;
      problems.forEach((p, i) => {
        message += formatProblemShort(i + 1, p);
      });
      message += `\n/why <번호> 로 5 Why 분석 가능`;

      await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (err) {
      await this.bot.sendMessage(chatId, '❌ 처리에 실패했습니다. API 연결과 권한을 확인하세요.');
    }
  }

  // /today 핸들러
  async _handleToday(chatId) {
    try {
      const problems = await this.notion.getTodayProblems();

      if (problems.length === 0) {
        await this.bot.sendMessage(chatId, '오늘 수집된 문제가 없습니다.');
        return;
      }

      let message = `*📅 오늘 수집된 문제 (${problems.length}건)*\n\n`;
      problems.slice(0, 10).forEach((p, i) => {
        message += formatProblemShort(i + 1, p);
      });

      await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (err) {
      await this.bot.sendMessage(chatId, '❌ 처리에 실패했습니다. API 연결과 권한을 확인하세요.');
    }
  }

  // /why 핸들러
  async _handleWhy(chatId, index) {
    const problem = this._lastTopResults[index - 1];

    if (!problem) {
      await this.bot.sendMessage(
        chatId,
        `번호 ${index}를 찾을 수 없습니다.\n먼저 /top을 조회하거나 [문제]로 직접 기록하세요.`
      );
      return;
    }

    await this.bot.sendMessage(
      chatId,
      `🔍 *5 Why 분석 중...*\n"${problem.problem_summary}"`,
      { parse_mode: 'Markdown' }
    );

    try {
      const whyResult = await this.analyzer.analyzeWhyChain(problem);

      if (!whyResult) {
        await this.bot.sendMessage(chatId, '❌ 5 Why 분석에 실패했습니다.');
        return;
      }

      let message = `*🔍 5 Why 분석*\n\n`;
      message += `*겉 문제:* ${whyResult.surface_problem}\n\n`;

      whyResult.why_chain?.forEach((step) => {
        message += `*Why ${step.level}.* ${step.why}\n→ ${step.answer}\n\n`;
      });

      message += `*🎯 진짜 문제:*\n${whyResult.root_problem}\n\n`;
      message += `*💡 기회:*\n${whyResult.opportunity}`;

      await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (err) {
      await this.bot.sendMessage(chatId, '❌ 처리에 실패했습니다. API 연결과 권한을 확인하세요.');
    }
  }

  // /status 핸들러
  async _handleStatus(chatId) {
    const checks = {
      'Gemini API': !!process.env.GEMINI_API_KEY,
      'Notion Token': !!process.env.NOTION_TOKEN,
      'Notion Problem DB': !!process.env.NOTION_PROBLEM_DB_ID,
      'Telegram Bot': !!process.env.TELEGRAM_BOT_TOKEN,
    };

    let message = `*⚙️ Problem Radar 상태*\n\n`;
    for (const [name, ok] of Object.entries(checks)) {
      message += `${ok ? '✅' : '❌'} ${name}\n`;
    }

    message += `\n*설정값*\n`;
    message += `점수는 정렬 참고용이며 낮은 점수도 추가 조사 후보로 보존합니다.\n`;
    message += `수집 경로: Telegram 직접 제보\n`;

    await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }

  // 직접 제보 핸들러
  async _handleDirectReport(chatId, text) {
    await this.bot.sendMessage(chatId, '📝 제보 수신. AI 분석 중...');

    try {
      const existing = await this.notion.getAllProblems();
      const report = await runCollection([{ source: '직접 제보', original_text: text,
        evidence_state: 'self_report', collected_at: new Date().toISOString() }], { analyzer: this.analyzer, existing });
      const record = report.records[0];
      if (record.disposition === 'duplicate') {
        await this.bot.sendMessage(chatId, '⏭️ 같은 원문이 이미 기록되어 있습니다.');
        return;
      }
      if (!record.analysis || record.plan.action === 'hold') {
        await this.bot.sendMessage(chatId, `처리 보류: ${record.plan.reason || record.disposition}. Notion은 변경하지 않았습니다. 원본 메시지는 이 채팅에 남아 있습니다.`);
        return;
      }
      const saved = await this.notion.saveProblem(record.analysis);
      const message = saved.review_required ? '🔎 기존 문제와 유사합니다. 독립 사건인지 확인한 후 증거 추가 여부를 결정하세요. 새 항목은 만들지 않았습니다.'
        : saved.skipped ? '⏭️ 이미 저장된 원문입니다.'
        : `✅ 수집함에 저장했습니다 (${record.disposition === 'needs_research' ? '추가 조사 후보' : '문제 가설'}). 점수는 수요의 증거가 아닙니다.\n${record.analysis.problem_summary}\n${saved.url || ''}`;
      await this.bot.sendMessage(chatId, message);
    } catch (err) {
      await this.bot.sendMessage(chatId, '❌ 처리에 실패했습니다. API 연결과 권한을 확인하세요.');
    }
  }
}

// 짧은 문제 포맷 (목록용)
function formatProblemShort(index, problem) {
  const score = problem.score ?? '?';
  const estimated = problem.is_estimated ? ' _(추정)_' : '';
  const category = problem.problem_category ? ` [${problem.problem_category}]` : '';
  return `*${index}. ${problem.problem_summary}*${category}\n   점수: ${score}점${estimated} | ${problem.target_user || '?'}\n\n`;
}

// 상세 문제 포맷 (제보/분석 결과용)
function formatProblemDetail(problem) {
  let text = `*📋 ${problem.problem_summary}*\n\n`;
  text += `카테고리: ${problem.problem_category || '?'}\n`;
  text += `대상: ${problem.target_user || '?'}\n`;
  text += `상황: ${problem.context || '?'}\n\n`;
  text += `빈도: ${problem.frequency}/10 | 고통: ${problem.pain}/10 | 지불의사: ${problem.willingness_to_pay}/10\n`;
  text += `비용 부담자: ${problem.cost_bearer || '미확인'}\n`;
  text += `가능한 지불 주체: ${problem.potential_payer || '미확인'}\n\n`;
  text += `*종합 점수: ${problem.score}점*`;
  return text;
}

const HELP_TEXT = `
*🔍 Problem Radar 봇*

한국 사용자들의 반복되는 불평에서 사업 기회를 찾습니다.

*커맨드*
/collect — 외부 자동 수집 비활성 안내
/top [N] — TOP N 문제 조회 (기본 10)
/today — 오늘 수집된 문제
/why <번호> — 5 Why 깊이 분석
/status — 시스템 상태 확인

*직접 제보*
\\[문제\\] 또는 \\[제보\\] 로 시작하는 메시지를 보내면 AI가 자동 분석합니다.

예시:
\`[문제] 건강보험 환급금 신청할 때마다 여러 사이트를 돌아다녀야 해서 너무 불편하다.\`
`.trim();

export default ProblemRadarBot;

// 직접 실행 시
if (process.argv[1]?.endsWith('telegram-bot.js')) {
  import('dotenv/config').then(() => {
    new ProblemRadarBot();
  });
}
