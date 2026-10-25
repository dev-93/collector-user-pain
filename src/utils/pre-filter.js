/**
 * pre-filter.js
 * 기존 호출 호환용 정렬 유틸. 실제 수집 정책과 보류 사유는 collection-pipeline.js가 관리한다.
 * 단어 포함 여부로 즉시 기각하지 않으며 점수는 정렬용 힌트다.
 */

import { COMPLAINT_SIGNALS } from '../config/index.js';
import { sourceKeys } from './candidate-policy.js';

// 고품질 불평 패턴 (이게 있으면 강한 사업 기회 신호)
const HIGH_VALUE_PATTERNS = [
  // 반복/수작업 고통
  '방법이 없', '어디서 해야', '대신 해주는', '해주는 곳이 없',
  '매번', '엑셀로', '수작업으로', '직접 해야',
  '왜 이런 기능이', '자동으로 안',
  // 구조적 부재 신호
  '한곳에서 안', '한 곳에서 안', '통합해주는 곳이', '연동이 안',
  '일일이', '하나하나', '따로따로', '매번 옮겨',
  '복붙', '복사 붙여', '수동으로', '사람이 직접',
  // 반복 지출/시간 낭비
  '매달', '매주', '매일 해야', '시간이 너무 걸',
  '돈 내기 아까', '비용이 너무',
];

/**
 * 단일 candidate의 사전 점수 계산 (0~100)
 */
function calcPreScore(candidate) {
  const text = candidate.original_text || '';
  const title = candidate.raw_title || '';
  const fullText = `${title} ${text}`;

  // 단어 하나가 아닌 사람이 기록한 글 유형으로 광고·운영자 자료를 분리한다.
  if (['advertisement', 'operator', 'general', 'repost'].includes(candidate.record_type)) return 0;

  // 최소 길이 (너무 짧으면 정보 없음)
  if (!text.trim()) return 0;

  let score = 0;

  // 불평 신호 개수 (핵심 지표)
  // 검색 쿼리 자체에서 주입된 signals는 증거가 아니다. 원문에 실제로 나타난
  // 표현만 계산해야 검색 결과 제목만으로 높은 점수를 받는 일을 막을 수 있다.
  const signalCount = COMPLAINT_SIGNALS.filter((p) => fullText.includes(p)).length;
  score += signalCount * 20; // 25 → 20으로 완화 (쿼리 보정 신호 포함되므로)

  // 고품질 패턴 가산
  const highValueCount = HIGH_VALUE_PATTERNS.filter((p) => fullText.includes(p)).length;
  score += highValueCount * 15;

  // 질문 형태 가산 (직접 도움을 구함)
  if (fullText.includes('?') || fullText.includes('어떻게') || fullText.includes('방법')) {
    score += 10;
  }

  // 텍스트 길이 보너스
  if (text.length > 100) score += 5;
  if (text.length > 200) score += 5;

  // 불평 표현 없이 서술된 운영 손실도 검토한다. 점수는 정렬용이다.
  if (/손실|손해|취소|노쇼|폐기|미수금|정산|대기|매출|인건비|시간|비용/.test(fullText)) score += 30;
  return Math.min(score, 100);
}

/**
 * 후보군 사전 필터링
 *
 * @param {Array} candidates - 수집기 원본 결과
 * @param {Object} options
 * @param {number} options.minPreScore - 최소 사전 점수 (기본 0; 수집 저장 기준이 아님)
 * @param {number} options.maxCount - 최대 통과 건수 (기본 50)
 * @param {boolean} options.verbose - 상세 로그 출력
 * @returns {Array} 필터링된 candidates
 */
export function preFilter(candidates, options = {}) {
  const { minPreScore = 0, maxCount = 50, verbose = true } = options;

  const total = candidates.length;

  // 유사 중복 제거 먼저
  const deduped = deduplicateSimilar(candidates);

  // 사전 점수 계산 후 정렬
  const scored = deduped
    .filter((c) => typeof c.original_text === 'string' && c.original_text.trim()
      && !['advertisement', 'operator', 'general', 'repost'].includes(c.record_type))
    .map((c) => ({ ...c, preScore: calcPreScore(c) }))
    .filter((c) => c.preScore >= minPreScore)
    .sort((a, b) => b.preScore - a.preScore)
    .slice(0, maxCount);

  if (verbose) {
    const afterDedup = deduped.length;
    const afterScore = deduped.filter((c) => calcPreScore(c) >= minPreScore).length;
    console.log(`\n🔬 사전 필터 결과:`);
    console.log(`   수집 원본:     ${total}건`);
    console.log(`   유사 중복 제거: ${total - afterDedup}건 → ${afterDedup}건`);
    console.log(`   점수 미달 제거: ${afterDedup - afterScore}건 (sPreScore < ${minPreScore})`);
    console.log(`   상위 제한:     최대 ${maxCount}건`);
    console.log(`   ✅ AI 분석 후보: ${scored.length}건 (실제 AI 호출: 최대 1회 배치)`);
  }

  return scored;
}

/**
 * 원문 식별자 기반 중복 제거. 제목은 중복 키가 아니다.
 */
export function deduplicateSimilar(candidates) {
  const seen = new Set();
  return candidates.filter((c) => {
    const keys = sourceKeys(c);
    if (!keys.length || keys.some((key) => seen.has(key))) return false;
    keys.forEach((key) => seen.add(key));
    return true;
  });
}
