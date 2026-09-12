/**
 * pre-filter.js
 * 규칙 기반 사전 필터 — Gemini API 호출 전 후보군을 대폭 줄인다
 *
 * 목적: 336건 → 최대 50건으로 압축 (토큰 85% 절감)
 *
 * 필터 기준:
 *   - 노이즈 패턴 포함 시 즉시 제외
 *   - 불평 신호 개수 (가장 강한 지표)
 *   - 텍스트 길이 / 질문 형태
 *   - 출처 신뢰도 (지식iN > 구글 뉴스)
 */

// 노이즈 패턴 (광고, 버그 리포트, 개인 일상 등 — 사업 기회 아님)
const NOISE_PATTERNS = [
  // 광고/홍보
  '광고', '홍보', '이벤트', '무료로 드립니다', '모집합니다',
  '구인', '구직', '채용', '제휴 문의', '협업 제안',
  // 버그/앱 오류
  '에러가 발생', '오류가 발생', '버그', 'crash', '앱이 안',
  '업데이트 후', '최근 업데이트', '새 버전에서',
  // 개인 의료/건강 질문 (사업 기회 아님)
  '소양증', '부분파열', '근육통', '고환', '부정교합',
  '진단', '증상이', '아픈데', '병원 다녀',
  // 개인 고민/감정
  '사는의미', '우울증인가', 'ENFP', 'MBTI', '성격유형',
  '싸가지', '친구가', '남자친구', '여자친구', '남친', '여친',
  '썸남', '썸녀', '연애',
  // 후기/리뷰 (개인 구매 경험)
  '내돈내산', '후기', '솔직리뷰', '사용기',
  // 지역 정보
  '구파발', '왕십리', '은평구',
];

// 고품질 불평 패턴 (이게 있으면 강한 사업 기회 신호)
const HIGH_VALUE_PATTERNS = [
  '방법이 없', '어디서 해야', '대신 해주는', '해주는 곳이 없',
  '매번 이렇게', '엑셀로', '수작업으로', '직접 해야',
  '왜 이런 기능이', '자동으로 안',
];

/**
 * 단일 candidate의 사전 점수 계산 (0~100)
 */
function calcPreScore(candidate) {
  const text = candidate.original_text || '';
  const title = candidate.raw_title || '';
  const fullText = `${title} ${text}`;

  // 노이즈 패턴 포함 시 즉시 제외
  if (NOISE_PATTERNS.some((p) => fullText.includes(p))) return 0;

  // 최소 길이 (너무 짧으면 정보 없음) — 구글 뉴스 제목만 있는 경우 20자로 완화
  const minLen = candidate.source?.includes('구글 뉴스') ? 20 : 30;
  if (text.length < minLen) return 0;

  let score = 0;

  // 불평 신호 개수 (핵심 지표)
  const signalCount = candidate.signals?.length || 0;
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

  // 출처 보너스 (지식iN은 실제 질문 = 신뢰도 높음)
  if (candidate.source?.includes('지식iN')) score += 15;
  // 앱리뷰는 실사용자 불만 = 신뢰도 높음
  if (candidate.source?.includes('앱 리뷰') || candidate.source?.includes('App Review')) score += 10;

  return Math.min(score, 100);
}

/**
 * 후보군 사전 필터링
 *
 * @param {Array} candidates - 수집기 원본 결과
 * @param {Object} options
 * @param {number} options.minPreScore - 최소 사전 점수 (기본 40)
 * @param {number} options.maxCount - 최대 통과 건수 (기본 50)
 * @param {boolean} options.verbose - 상세 로그 출력
 * @returns {Array} 필터링된 candidates
 */
export function preFilter(candidates, options = {}) {
  const { minPreScore = 40, maxCount = 50, verbose = true } = options;

  const total = candidates.length;

  // 유사 중복 제거 먼저
  const deduped = deduplicateSimilar(candidates);

  // 사전 점수 계산 후 정렬
  const scored = deduped
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
    console.log(`   ✅ AI 분석 대상: ${scored.length}건 (Gemini ${scored.length}회 호출)`);
    const saved = total - scored.length;
    console.log(`   💰 토큰 절감:  ${saved}건 생략 (약 ${Math.round(saved * 1.5)}초 단축)\n`);
  }

  return scored;
}

/**
 * 유사 중복 제거 — 제목 앞 20자 기준
 */
export function deduplicateSimilar(candidates) {
  const seen = new Map();
  return candidates.filter((c) => {
    const key = (c.raw_title || c.original_text || '').slice(0, 20).trim();
    if (!key || seen.has(key)) return false;
    seen.set(key, true);
    return true;
  });
}
