/**
 * ai-analyzer.js
 * 수집된 불평 원문을 구조화된 Problem으로 변환한다
 *
 * 폴백 체인: OpenRouter → Groq → Gemini
 * - 각 provider가 429를 반환하면 자동으로 다음 provider로 전환
 * - 키가 설정된 provider만 체인에 포함됨
 *
 * 처리 흐름:
 *   원문 candidate → AI 분석 → Problem 구조체 → Notion 저장
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { SYSTEM_PROMPT, buildAnalysisPrompt, buildBatchAnalysisPrompt } from '../prompts/analyze.js';
import {
  AI_CONFIG,
  MIN_SCORE,
  SCORE_WEIGHTS,
  FREE_TIER_AI_LIMIT,
} from '../config/index.js';

// 배치 크기: 한 번의 API 호출로 처리할 최대 건수
const BATCH_SIZE = 10;

class AIAnalyzer {
  constructor() {
    // 사용 가능한 provider 체인 구성 (키가 있는 것만 포함)
    this._chain = this._buildChain();
    this._chainIdx = 0; // 현재 사용 중인 provider 인덱스

    if (this._chain.length === 0) {
      throw new Error('사용 가능한 AI provider가 없습니다. .env에 OPENROUTER_API_KEY, GROQ_API_KEY, GEMINI_API_KEY 중 하나 이상을 설정하세요.');
    }

    const names = this._chain.map((p) => p.name).join(' → ');
    console.log(`🔀 AI 폴백 체인: ${names}`);

    const missing = [
      ['OPENROUTER_API_KEY', process.env.OPENROUTER_API_KEY],
      ['GROQ_API_KEY', process.env.GROQ_API_KEY],
      ['GEMINI_API_KEY', process.env.GEMINI_API_KEY],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length > 0) {
      console.log(`ℹ️  비활성 폴백: ${missing.join(', ')} 미설정`);
    }
  }

  /**
   * 키가 설정된 provider만 순서대로 체인에 추가
   * 순서: OpenRouter → Groq → Gemini
   */
  _buildChain() {
    const chain = [];

    if (process.env.OPENROUTER_API_KEY) {
      chain.push({
        name: `OpenRouter (${AI_CONFIG.openrouter.model})`,
        call: (prompt) => this._openrouterGenerate(prompt),
      });
    }

    if (process.env.GROQ_API_KEY) {
      chain.push({
        name: `Groq (${AI_CONFIG.groq.model})`,
        call: (prompt) => this._groqGenerate(prompt),
      });
    }

    if (process.env.GEMINI_API_KEY) {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      this._geminiModel = genAI.getGenerativeModel({
        model: AI_CONFIG.gemini.model,
        systemInstruction: SYSTEM_PROMPT,
      });
      chain.push({
        name: `Gemini (${AI_CONFIG.gemini.model})`,
        call: (prompt) => this._geminiGenerate(prompt),
      });
    }

    return chain;
  }

  /**
   * 폴백 체인을 따라 텍스트 생성 요청
   * 현재 provider가 429 반환 시 다음 provider로 자동 전환
   */
  async generateText(prompt) {
    while (this._chainIdx < this._chain.length) {
      const provider = this._chain[this._chainIdx];
      try {
        return await provider.call(prompt);
      } catch (err) {
        if (err instanceof QuotaExceededError) {
          const next = this._chain[this._chainIdx + 1];
          if (next) {
            console.warn(`\n⚡ ${provider.name} 한도 초과 — ${next.name}으로 전환합니다.`);
            this._chainIdx++;
            continue;
          }
          // 체인 끝까지 소진
          throw new QuotaExceededError('모든 AI provider 한도 초과');
        }
        throw err;
      }
    }
    throw new QuotaExceededError('모든 AI provider 한도 초과');
  }

  /**
   * OpenRouter API 호출 (OpenAI 호환)
   */
  async _openrouterGenerate(prompt) {
    const response = await fetch(`${AI_CONFIG.openrouter.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/problem-radar',
        'X-Title': 'Problem Radar',
      },
      body: JSON.stringify({
        model: AI_CONFIG.openrouter.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      if (response.status === 429) throw new QuotaExceededError(`OpenRouter 한도 초과: ${errText}`);
      throw new Error(`OpenRouter API 오류 ${response.status}: ${errText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
  }

  /**
   * Groq API 호출 (OpenAI 호환)
   * - 우선 모델이 404를 반환하면 fallbackModel로 재시도
   * - 429는 다음 provider로 폴백하도록 QuotaExceededError를 던짐
   */
  async _groqGenerate(prompt) {
    const models = [
      AI_CONFIG.groq.model,
      ...(AI_CONFIG.groq.fallbackModel ? [AI_CONFIG.groq.fallbackModel] : []),
    ];

    let lastErr;
    for (const model of models) {
      const response = await fetch(`${AI_CONFIG.groq.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return data.choices?.[0]?.message?.content?.trim() || '';
      }

      const errText = await response.text();
      if (response.status === 429) {
        throw new QuotaExceededError(`Groq 한도 초과: ${errText}`);
      }
      if (response.status === 404) {
        // 모델이 없거나 접근 불가 → 다음 모델 시도
        console.warn(`\n⚠️  Groq 모델 [${model}] 없음(404) — 다음 모델로 시도합니다.`);
        lastErr = new Error(`Groq API 오류 ${response.status}: ${errText}`);
        continue;
      }
      // 그 외 오류는 즉시 다음 provider로 폴백 (QuotaExceededError로 래핑)
      throw new QuotaExceededError(`Groq 오류(${response.status}), 다음 provider로 전환: ${errText}`);
    }

    // 모든 모델 실패 시 다음 provider로 폴백
    throw new QuotaExceededError(`Groq 모델 전체 실패 — 다음 provider로 전환: ${lastErr?.message}`);
  }

  /**
   * Gemini API 호출
   */
  async _geminiGenerate(prompt) {
    if (!this._geminiModel) {
      throw new Error('Gemini 모델이 초기화되지 않았습니다.');
    }
    const result = await this._geminiModel.generateContent(prompt);
    return result.response.text().trim();
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

      const score = calculateScore(parsed);
      return {
        ...parsed,
        score,
        analysis_status: 'ai_analyzed',
        source: candidate.source,
        source_url: candidate.source_url,
        source_item_id: candidate.source_item_id,
        source_evidence_state: candidate.evidence_state || 'unverified',
        original_text: candidate.original_text,
        collected_at: candidate.collected_at || new Date().toISOString(),
        status: score >= MIN_SCORE ? '수집됨' : '기각',
      };
    } catch (err) {
      if (err instanceof QuotaExceededError) throw err;
      const isQuotaExceeded = err.message?.includes('429');
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
        const score = calculateScore(item);
        return {
          ...item,
          score,
          analysis_status: 'ai_analyzed',
          source: candidate.source,
          source_url: candidate.source_url,
          source_item_id: candidate.source_item_id,
          source_evidence_state: candidate.evidence_state || 'unverified',
          original_text: candidate.original_text,
          collected_at: candidate.collected_at || new Date().toISOString(),
          status: score >= MIN_SCORE ? '수집됨' : '기각',
        };
      });
    } catch (err) {
      if (err instanceof QuotaExceededError) throw err;
      const isQuotaExceeded = err.message?.includes('429');
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
    const requestedLimit = parseInt(process.env.AI_LIMIT) || FREE_TIER_AI_LIMIT;
    const {
      minScore = MIN_SCORE,
      aiLimit = requestedLimit,
      allowIndividualFallback = false,
    } = options;
    const effectiveAiLimit = Math.min(aiLimit, FREE_TIER_AI_LIMIT);

    const aiTargets = candidates.slice(0, effectiveAiLimit);
    const ruleTargets = candidates.slice(effectiveAiLimit);

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
          if (!allowIndividualFallback) {
            console.log(`\n  ↩️  배치 ${batchIdx + 1} 결과를 읽지 못해 건너뜁니다 (무료 한도 보호).`);
            continue;
          }

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
          console.error(`\n🚫 모든 AI provider 한도 초과 — 규칙 점수로 전환합니다.`);
          const remaining = aiTargets.slice(start);
          ruleTargets.unshift(...remaining);
          break;
        }
        throw err;
      }

      if (batchIdx < totalBatches - 1) await sleep(3000);
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
      frequency: null,
      pain: null,
      willingness_to_pay: null,
      score: null,
      rule_score: c.preScore || 0,
      analysis_status: 'rule_only',
      is_estimated: true,
      skip_reason: 'AI 한도 초과로 규칙 점수 사용',
      source: c.source,
      source_url: c.source_url,
      source_evidence_state: c.evidence_state || 'unverified',
      original_text: c.original_text,
      collected_at: c.collected_at || new Date().toISOString(),
      status: '검토필요',
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
      evidence_state: 'self_report',
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

// 모델이 임의로 작성한 score를 신뢰하지 않고, 수집 단계의 핵심 근거 점수만으로 재계산한다.
function calculateScore(result) {
  const value = (key) => {
    const n = Number(result?.[key]);
    return Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : 0;
  };
  const positive = Object.entries(SCORE_WEIGHTS)
    .reduce((sum, [key, weight]) => sum + value(key) * weight, 0) * 10;
  return Math.round(Math.max(0, Math.min(100, positive)));
}

export default AIAnalyzer;

// 직접 실행 시 테스트
if (process.argv[1]?.endsWith('ai-analyzer.js')) {
  import('dotenv/config').then(async () => {
    const analyzer = new AIAnalyzer();

    const testCandidate = {
      source: '직접 제보',
      source_url: null,
      original_text: '[질문] 건강보험 환급금 신청 방법이 없나요?\n[내용] 매번 여러 사이트를 돌아다니면서 확인해야 하는데 너무 불편해요. 자동으로 알려주는 서비스가 없을까요?',
      signals: ['매번', '너무 불편', '방법이 없나'],
      evidence_state: 'self_report',
      collected_at: new Date().toISOString(),
    };

    console.log('🤖 테스트 분석 중...');
    const result = await analyzer.analyze(testCandidate);
    console.log('\n📋 분석 결과:');
    console.log(JSON.stringify(result, null, 2));
  });
}
