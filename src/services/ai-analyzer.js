/**
 * ai-analyzer.js
 * Gemini API로 수집된 불평 원문을 구조화된 Problem으로 변환한다
 *
 * 처리 흐름:
 *   원문 candidate → Gemini 분석 → Problem 구조체 → Notion 저장
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { SYSTEM_PROMPT, buildAnalysisPrompt } from '../prompts/analyze.js';

const MODEL = 'gemini-3.6-flash'; // 최신 Gemini 3.6 Flash 모델 사용

class AIAnalyzer {
  constructor() {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY가 .env에 없습니다.');
    }
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.model = genAI.getGenerativeModel({
      model: MODEL,
      systemInstruction: SYSTEM_PROMPT,
    });
  }

  /**
   * 단일 candidate 분석 (429 Rate Limit 발생 시 자동 재시도)
   * @param {Object} candidate - 수집기가 반환한 원문 데이터
   * @param {number} retries - 재시도 횟수
   * @returns {Object|null} 분석 결과 또는 null (분석 실패 시)
   */
  async analyze(candidate, retries = 3) {
    const prompt = buildAnalysisPrompt(candidate);

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const result = await this.model.generateContent(prompt);
        const text = result.response.text().trim();

        // JSON 파싱
        const parsed = parseJSON(text);
        if (!parsed) {
          console.warn('⚠️  JSON 파싱 실패:', text.slice(0, 100));
          return null;
        }

        // 원본 메타 정보 병합
        return {
          ...parsed,
          source: candidate.source,
          source_url: candidate.source_url,
          original_text: candidate.original_text,
          collected_at: candidate.collected_at || new Date().toISOString(),
          status: (parsed.score || 0) >= (parseInt(process.env.MIN_SCORE) || 50)
            ? '수집됨'
            : '기각',
        };
      } catch (err) {
        const isRateLimit = err.message?.includes('429') || err.message?.includes('Quota exceeded');
        if (isRateLimit && attempt < retries) {
          const waitTime = attempt * 5000;
          console.warn(`\n⚠️ Gemini API 한도(429) 발생. ${waitTime / 1000}초 후 재시도 (${attempt}/${retries})...`);
          await sleep(waitTime);
          continue;
        }
        console.error('❌ AI 분석 오류:', err.message);
        return null;
      }
    }
    return null;
  }

  /**
   * 여러 candidates 배치 분석
   * @param {Array} candidates
   * @param {Object} options
   * @param {number} options.minScore - 이 점수 미만은 저장 스킵
   * @param {Function} options.onProgress - 진행 콜백 (index, total, result)
   * @returns {Promise<Array>} 분석 완료된 문제 목록
   */
  async analyzeAll(candidates, options = {}) {
    const { minScore = 50, onProgress } = options;
    const results = [];
    const total = candidates.length;

    console.log(`🤖 AI 분석 시작: ${total}건`);

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];

      // 진행 상황 출력
      process.stdout.write(`\r  분석 중... ${i + 1}/${total}`);

      const result = await this.analyze(candidate);

      if (result) {
        results.push(result);
        if (onProgress) onProgress(i, total, result);
      }

      // API 과부하 방지 (Gemini Flash: 15 RPM 무료)
      await sleep(1000);
    }

    console.log('\n');

    const passed = results.filter((r) => r.score >= minScore);
    const rejected = results.filter((r) => r.score < minScore);

    console.log(`✅ 분석 완료:`);
    console.log(`   전체 ${total}건 → 성공 ${results.length}건`);
    console.log(`   점수 ${minScore}+ 통과: ${passed.length}건`);
    console.log(`   낮은 점수 기각: ${rejected.length}건`);

    return results;
  }

  /**
   * 직접 제보 텍스트 분석 (Telegram /report 커맨드용)
   * 사용자가 직접 입력한 문제 설명을 구조화
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
   * 수집/점수화 단계 이후, 좋은 문제를 더 깊이 파고들 때 사용
   * @param {Object} problem - 분석이 완료된 Problem 구조체
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
      const result = await this.model.generateContent(prompt);
      const text = result.response.text().trim();
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
    // ```json ... ``` 또는 ``` ... ``` 제거
    const cleaned = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    return JSON.parse(cleaned);
  } catch {
    // JSON 부분만 추출 시도
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
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
