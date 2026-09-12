/**
 * ai-analyzer.js
 * 수집된 불평 원문을 구조화된 Problem으로 변환한다
 *
 * AI_PROVIDER 환경변수로 provider 전환:
 *   AI_PROVIDER=gemini    → Gemini API (기본, 무료 하루 20회)
 *   AI_PROVIDER=openrouter → OpenRouter API (무료 모델 사용)
 *
 * 처리 흐름:
 *   원문 candidate → AI 분석 → Problem 구조체 → Notion 저장
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { SYSTEM_PROMPT, buildAnalysisPrompt, buildBatchAnalysisPrompt } from '../prompts/analyze.js';

// 배치 크기: 한 번의 API 호출로 처리할 최대 건수
const BATCH_SIZE = 10;

// Gemini 모델 (변경 금지)
const GEMINI_MODEL = 'gemini-3.6-flash';

// OpenRouter 기본 모델 — 무료 + 한국어 품질 우수
// 환경변수 OPENROUTER_MODEL 로 재정의 가능
const OPENROUTER_DEFAULT_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

class AIAnalyzer {
  constructor() {
    this.provider = (process.env.AI_PROVIDER || 'gemini').toLowerCase();

    if (this.provider === 'openrouter') {
      if (!process.env.OPENROUTER_API_KEY) {
        throw new Error('OPENROUTER_API_KEY가 .env에 없습니다.');
      }
      this.openrouterModel = process.env.OPENROUTER_MODEL || OPENROUTER_DEFAULT_MODEL;
      console.log(`🔀 AI Provider: OpenRouter (${this.openrouterModel})`);
    } else {
      if (!process.env.GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY가 .env에 없습니다.');
      }
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      this.geminiModel = genAI.getGenerativeModel({
        model: GEMINI_MODEL,
        systemInstruction: SYSTEM_PROMPT,
      });
      console.log(`🔀 AI Provider: Gemini (${GEMINI_MODEL})`);
    }
  }

  /**
   * provider에 맞게 텍스트 생성 요청
   * @param {string} prompt
   * @returns {Promise<string>} 응답 텍스트
   */
  async generateText(prompt) {
    if (this.provider === 'openrouter') {
      return this._openrouterGenerate(prompt);
    }
    const result = await this.geminiModel.generateContent(prompt);
    return result.response.text().trim();
  }

  /**
   * OpenRouter API 호출 (OpenAI 호환)
   */
  async _openrouterGenerate(prompt) {
    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/problem-radar',
        'X-Title': 'Problem Radar',
      },
      body: JSON.stringify({
        model: this.openrouterModel,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      // 한도 초과 감지
      if (response.status === 429 || errText.includes('quota') || errText.includes('rate limit')) {
        throw new QuotaExceededError(`OpenRouter 한도 초과: ${errText}`);
      }
      throw new Error(`OpenRouter API 오류 ${response.status}: ${errText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
  }

  /**
   * 단일 candidate 분석
   */
  async analyze(candidate) {
    const prompt = buildAnalysisPrompt(candidate);

    try {
      const text = await this.generateText(prompt);

      const parsed = parseJSON(text);
      if (!parsed) {
        console.warn('⚠️  JSON 파싱 실패:', text.slice(0, 100));
        return null;
      }

      return {
        ...parsed,
        source: candidate.source,
        source_url: candidate.source_url,
        original_text: candidate.original_text,
        collected_at: candidate.collected_at || new Date().toISOString(),
        status: (parsed.score || 0) >= (parseInt(process.env.MIN_SCORE) || 70)
          ? '수집됨'
          : '기각',
      };
    } catch (err) {
      if (err instanceof QuotaExceededError) throw err;
      const isQuotaExceeded =
        err.message?.includes('429') ||
        err.message?.includes('Quota exceeded') ||
        err.message?.includes('quota');
      if (isQuotaExceeded) throw new QuotaExceededError(err.message);
      console.error('❌ AI 분석 오류:', err.message);
      return null;
    }
  }

  /**
   * 배치 단위 분석 — BATCH_SIZE건을 1회 API 호출로 처리
   */
  async analyzeBatch(batch) {
    const prompt = buildBatchAnalysisPrompt(batch);

    try {
      const text = await this.generateText(prompt);

      const parsed = parseBatchJSON(text, batch.length);
      if (!parsed) {
        console.warn(`⚠️  배치 JSON 파싱 실패 (${batch.length}건) — 개별 분석으로 폴백`);
        return null;
      }

      return parsed.map((item, i) => {
        const candidate = batch[i];
        if (!item) return null;
        return {
          ...item,
          source: candidate.source,
          source_url: candidate.source_url,
          original_text: candidate.original_text,
          collected_at: candidate.collected_at || new Date().toISOString(),
          status: (item.score || 0) >= (parseInt(process.env.MIN_SCORE) || 70)
            ? '수집됨'
            : '기각',
        };
      });
    } catch (err) {
      if (err instanceof QuotaExceededError) throw err;
      const isQuotaExceeded =
        err.message?.includes('429') ||
        err.message?.includes('Quota exceeded') ||
        err.message?.includes('quota');
      if (isQuotaExceeded) throw new QuotaExceededError(err.message);
      console.error('❌ 배치 분석 오류:', err.message);
      return null;
    }
  }

  /**
   * 여러 candidates 배치 분석
   * - preScore 상위 AI_LIMIT건만 AI로 분석 (하루 한도 보호)
   * - 나머지는 규칙 기반 preScore를 score로 사용 (폴백)
   * - BATCH_SIZE건씩 묶어 1회 API 호출로 처리 (토큰 절감)
   */
  async analyzeAll(candidates, options = {}) {
    const { minScore = 70, aiLimit = parseInt(process.env.AI_LIMIT) || 15 } = options;

    const aiTargets = candidates.slice(0, aiLimit);
    const ruleTargets = candidates.slice(aiLimit);

    const totalBatches = Math.ceil(aiTargets.length / BATCH_SIZE);
    console.log(`🤖 AI 분석 시작: 상위 ${aiTargets.length}건 (${totalBatches}회 배치 호출)`);
    if (ruleTargets.length > 0) {
      console.log(`📐 규칙 점수 폴백: 나머지 ${ruleTargets.length}건 (API 호출 없음)`);
    }

    const aiResults = [];

    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
      const start = batchIdx * BATCH_SIZE;
      const batch = aiTargets.slice(start, start + BATCH_SIZE);

      process.stdout.write(`\r  배치 분석 중... ${batchIdx + 1}/${totalBatches} (${start + batch.length}/${aiTargets.length}건)`);

      try {
        const batchResults = await this.analyzeBatch(batch);

        if (batchResults === null) {
          console.log(`\n  ↩️  배치 ${batchIdx + 1} 개별 분석 폴백...`);
          for (const candidate of batch) {
            try {
              const result = await this.analyze(candidate);
              if (result) aiResults.push(result);
            } catch (err) {
              if (err instanceof QuotaExceededError) throw err;
            }
            await sleep(1000);
          }
        } else {
          for (const r of batchResults) {
            if (r) aiResults.push(r);
          }
        }
      } catch (err) {
        if (err instanceof QuotaExceededError) {
          process.stdout.write('\n');
          console.error(`\n🚫 API 한도 초과 — AI 분석 중단 (배치 ${batchIdx + 1}/${totalBatches})`);
          console.error('   규칙 점수로 나머지를 채웁니다.');
          const remaining = aiTargets.slice(start);
          ruleTargets.unshift(...remaining);
          break;
        }
        throw err;
      }

      if (batchIdx < totalBatches - 1) await sleep(2000);
    }

    process.stdout.write('\n');

    // 규칙 점수 폴백
    const ruleResults = ruleTargets.map((c) => ({
      problem_summary: c.raw_title?.slice(0, 60) || c.original_text?.slice(0, 60) || '(요약 없음)',
      target_user: null,
      context: null,
      problem_category: '기타',
      current_solution: null,
      solution_gap: null,
      competitors: null,
      frequency: null,
      pain: null,
      willingness_to_pay: null,
      market_size: null,
      competition_gap: null,
      my_fit: null,
      development_difficulty: null,
      score: c.preScore || 0,
      is_estimated: true,
      mvp_idea: null,
      skip_reason: 'AI 한도 초과로 규칙 점수 사용',
      source: c.source,
      source_url: c.source_url,
      original_text: c.original_text,
      collected_at: c.collected_at || new Date().toISOString(),
      status: (c.preScore || 0) >= minScore ? '수집됨(규칙)' : '기각',
    }));

    const allResults = [...aiResults, ...ruleResults];
    const passed = allResults.filter((r) => r.score >= minScore);
    const rejected = allResults.filter((r) => r.score < minScore);

    console.log(`\n✅ 분석 완료:`);
    console.log(`   AI 분석: ${aiResults.length}건 / 규칙 폴백: ${ruleResults.length}건`);
    console.log(`   점수 ${minScore}+ 통과: ${passed.length}건`);
    console.log(`   낮은 점수 기각: ${rejected.length}건`);

    return allResults;
  }

  /**
   * 직접 제보 텍스트 분석 (Telegram /report 커맨드용)
   */
  async analyzeRawText(text, source = '직접 제보') {
    const candidate = {
      source,
      source_url: null,
      original_text: text,
      signals: [],
      collected_at: new Date().toISOString(),
    };
    return this.analyze(candidate);
  }

  /**
   * TOP 문제 5 Why 분석
   */
  async analyzeWhyChain(problem) {
    const prompt = `
다음 문제에 대해 "5 Why" 분석을 수행하라.
각 "왜?"마다 한 단계씩 깊게 파고들어, 겉으로 보이는 불편 → 진짜 근본 문제를 찾아라.

[문제]
${problem.problem_summary}

[상황]
대상: ${problem.target_user}
맥락: ${problem.context}

JSON 형식으로만 응답:
{
  "surface_problem": "겉으로 보이는 문제",
  "why_chain": [
    { "level": 1, "why": "왜 이 문제가 생기는가", "answer": "..." },
    { "level": 2, "why": "그러면 왜 그런가", "answer": "..." },
    { "level": 3, "why": "그러면 왜 그런가", "answer": "..." },
    { "level": 4, "why": "그러면 왜 그런가", "answer": "..." },
    { "level": 5, "why": "그러면 왜 그런가", "answer": "..." }
  ],
  "root_problem": "진짜 문제는 무엇인가 (1~2문장)",
  "opportunity": "이 근본 문제를 해결하면 어떤 기회가 생기는가"
}
`;

    try {
      const text = await this.generateText(prompt);
      return parseJSON(text);
    } catch (err) {
      console.error('❌ 5 Why 분석 오류:', err.message);
      return null;
    }
  }
}

// JSON 파싱 (마크다운 코드블록 제거 후 시도)
function parseJSON(text) {
  try {
    const cleaned = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    return JSON.parse(cleaned);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { return null; }
    }
    return null;
  }
}

// 배치 응답 파싱 — JSON 배열 추출
function parseBatchJSON(text, expectedCount) {
  try {
    const cleaned = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed) && parsed.length === expectedCount) return parsed;
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    return null;
  } catch {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) return parsed;
      } catch { return null; }
    }
    return null;
  }
}

class QuotaExceededError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export default AIAnalyzer;

// 직접 실행 시 테스트
if (process.argv[1].endsWith('ai-analyzer.js')) {
  import('dotenv/config').then(async () => {
    const analyzer = new AIAnalyzer();

    const testCandidate = {
      source: '네이버 지식iN',
      source_url: 'https://kin.naver.com/test',
      original_text: '[질문] 건강보험 환급금 신청 방법이 없나요?\n[내용] 매번 여러 사이트를 돌아다니면서 확인해야 하는데 너무 불편해요. 자동으로 알려주는 서비스가 없을까요?',
      signals: ['매번', '너무 불편', '방법이 없나'],
      collected_at: new Date().toISOString(),
    };

    console.log('🤖 테스트 분석 중...');
    const result = await analyzer.analyze(testCandidate);
    console.log('\n📋 분석 결과:');
    console.log(JSON.stringify(result, null, 2));
  });
}
