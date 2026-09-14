/**
 * analyze.js
 * AI에 전달할 문제 분석 프롬프트
 *
 * 분석 기준:
 *   - 단순 불만 vs 실제 사업 기회 구분
 *   - 나의 역량과 문제의 fit 판단
 *   - 점수가 약하면 솔직하게 낮게, 근거 없으면 "추정" 표시
 */

import { MY_WEAPONS } from '../config/index.js';

const weaponSummary = `
기술: ${MY_WEAPONS.skills.join(', ')}
경험: ${MY_WEAPONS.experience.join(', ')}
도메인 지식: ${MY_WEAPONS.domain.join(', ')}
자원: ${MY_WEAPONS.advantages.join(', ')}
`;

export const SYSTEM_PROMPT = `
너의 목적은 사업 아이디어를 만드는 것이 아니다.

한국 사용자들이 실제로 반복해서 겪는 문제를 발견하고,
그 문제의 크기와 강도를 검증하는 것이다.

다음과 같은 표현을 높은 가치의 신호로 판단한다:
- 너무 불편하다 / 불편해요
- 매번 해야 한다 / 매번 이렇게
- 방법이 없나 / 방법이 없을까
- 왜 이런 기능이 없나
- 어디서 해야 하는지 모르겠다
- 대신 해주는 곳이 없나
- 시간이 너무 오래 걸린다
- 여러 서비스를 동시에 사용해야 한다
- 엑셀/수작업으로 처리한다
- 사람이 직접 문의해야 한다
- 귀찮다 / 번거롭다

단순한 불만과 실제 사업 기회를 구분한다.
좋은 아이디어를 억지로 만들지 않는다.
문제가 약하면 낮은 점수를 준다.
근거가 부족하면 is_estimated: true 로 표시한다.

분석 의뢰인의 역량:
${weaponSummary}
`.trim();

export function buildAnalysisPrompt(candidate) {
  return `
다음 원문을 분석해서 JSON으로만 응답하라. 마크다운 코드블록 없이 순수 JSON만.

[원문]
출처: ${candidate.source}
URL: ${candidate.source_url}
텍스트:
${candidate.original_text}
${candidate.signals?.length ? `\n감지된 불평 신호: ${candidate.signals.join(', ')}` : ''}

[분석 지시]
아래 JSON 형식으로 정확히 응답하라:

{
  "problem_summary": "문제를 한 문장으로 요약 (30자 이내, 한국어)",
  "target_user": "이 문제를 겪는 사람 (예: 직장인, 육아 중인 부모)",
  "context": "어떤 상황에서 발생하는가 (1~2문장)",
  "problem_category": "정보 탐색|행정/서류|예약/스케줄|결제/금융|의사소통|반복 작업|비교/선택|배움/교육|이동/물류|건강/의료|육아/가족|직장/업무|기타 중 하나",
  "current_solution": "지금 사람들이 이 문제를 어떻게 해결하고 있는가",
  "solution_gap": "현재 해결책의 문제점",
  "competitors": "기존 경쟁 서비스 (없으면 '없음')",

  "evidence_quote": "원문에서 문제를 직접 보여주는 짧은 인용 (없으면 null)",
  "evidence_type": "직접 경험|반복 행동|현재 지출|단순 불만|정보 부족 중 하나",
  "evidence_gaps": ["이 원문만으로 알 수 없는 중요한 사실"],
  "confidence": "high|medium|low",

  "frequency": 1~10 (이 문제가 얼마나 자주 발생하는가),
  "pain": 1~10 (얼마나 고통스러운가),
  "willingness_to_pay": 1~10 (돈을 낼 가능성),
  "market_size": 1~10 (시장 크기),
  "competition_gap": 1~10 (경쟁이 해결 못 한 기회),
  "my_fit": 1~10 (의뢰인의 역량으로 해결 가능한가),
  "development_difficulty": 1~10 (개발 난이도, 낮을수록 쉬움),
  "score": 0~100 (종합 점수: 빈도×20% + 고통×20% + 지불의사×20% + 시장성×15% + 경쟁기회×10% + 내적합도×15% - 개발난이도×10%),

  "is_estimated": true/false (점수가 추정에 기반하면 true),
  "mvp_idea": "1~7일 안에 만들 수 있는 MVP 아이디어 (없으면 null)",
  "validation_question": "가장 먼저 검증해야 할 질문",
  "validation_offer": "코딩 전에 제안할 수 있는 수동 해결/유료 테스트",
  "skip_reason": "점수 50 미만이라면 낮은 이유 설명, 아니면 null"
}

규칙:
- 단순 버그 불만(로그인 안 됨, 오류 발생)은 score 30 이하
- 구조적 문제(기능 부재, 반복 수작업)는 가중치 높게
- my_fit은 의뢰인의 역량과 직접 연결해서 판단
- 정보가 부족하면 is_estimated: true + 보수적 점수
- frequency, willingness_to_pay, market_size는 원문에 근거가 없으면 낮게 평가하고 evidence_gaps에 이유를 적는다
- 개인의 증상, 사고, 법률·금융 문의 자체는 사업 문제로 간주하지 않는다. 반복 업무나 지불 행동이 명시되지 않으면 낮은 점수를 준다
`;
}

/**
 * 배치 분석용 프롬프트 — 여러 건을 한 번의 API 호출로 처리
 * @param {Array} candidates - 최대 10건
 * @returns {string} 프롬프트 문자열
 */
export function buildBatchAnalysisPrompt(candidates) {
  const items = candidates
    .map((c, i) => `
--- [${i}] ---
출처: ${c.source}
URL: ${c.source_url || 'N/A'}
텍스트: ${c.original_text.slice(0, 400)}
${c.signals?.length ? `불평 신호: ${c.signals.join(', ')}` : ''}
`.trim())
    .join('\n\n');

  return `
아래 ${candidates.length}건의 원문을 각각 분석해서 JSON 배열로만 응답하라.
마크다운 코드블록 없이 순수 JSON 배열만. 반드시 ${candidates.length}개 원소를 가진 배열이어야 한다.

[원문 목록]
${items}

[각 항목에 대한 분석 형식]
배열의 각 원소는 인덱스 순서대로 아래 구조를 따른다:

{
  "problem_summary": "문제를 한 문장으로 요약 (30자 이내, 한국어)",
  "target_user": "이 문제를 겪는 사람",
  "context": "어떤 상황에서 발생하는가 (1~2문장)",
  "problem_category": "정보 탐색|행정/서류|예약/스케줄|결제/금융|의사소통|반복 작업|비교/선택|배움/교육|이동/물류|건강/의료|육아/가족|직장/업무|기타 중 하나",
  "current_solution": "지금 사람들이 이 문제를 어떻게 해결하고 있는가",
  "solution_gap": "현재 해결책의 문제점",
  "competitors": "기존 경쟁 서비스 (없으면 '없음')",
  "evidence_quote": "원문 인용 또는 null",
  "evidence_type": "직접 경험|반복 행동|현재 지출|단순 불만|정보 부족 중 하나",
  "evidence_gaps": ["확인되지 않은 핵심 가정"],
  "confidence": "high|medium|low",
  "frequency": 1~10,
  "pain": 1~10,
  "willingness_to_pay": 1~10,
  "market_size": 1~10,
  "competition_gap": 1~10,
  "my_fit": 1~10,
  "development_difficulty": 1~10,
  "score": 0~100 (빈도×20% + 고통×20% + 지불의사×20% + 시장성×15% + 경쟁기회×10% + 내적합도×15% - 개발난이도×10%),
  "is_estimated": true/false,
  "mvp_idea": "1~7일 MVP 아이디어 또는 null",
  "validation_question": "가장 먼저 검증할 질문",
  "validation_offer": "수동 해결 또는 유료 테스트 제안",
  "skip_reason": "점수 50 미만 이유 또는 null"
}

규칙:
- 단순 버그 불만(로그인 안 됨, 오류 발생)은 score 30 이하
- 구조적 문제(기능 부재, 반복 수작업)는 가중치 높게
- my_fit은 의뢰인의 역량과 직접 연결해서 판단
- 정보가 부족하면 is_estimated: true + 보수적 점수
- 개인의 증상, 사고, 법률·금융 문의 자체는 사업 문제로 간주하지 않는다. 반복 업무나 지불 행동이 없으면 보수적으로 평가
- 반드시 ${candidates.length}개 원소를 가진 배열로만 응답
`;
}
