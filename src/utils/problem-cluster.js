/**
 * 같은 수집 실행 안에서 의미가 가까운 분석 결과를 문제군으로 묶는다.
 * 완전한 의미 검색이 아니라, 현재 데이터에서 반복 증거를 보이기 위한 보수적 1차 군집이다.
 */

function normalize(text = '') {
  return text
    .toLowerCase()
    .replace(/[^가-힣a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(text) {
  const value = normalize(text).replace(/ /g, '');
  return new Set(Array.from({ length: Math.max(0, value.length - 1) }, (_, i) => value.slice(i, i + 2)));
}

function similarity(a, b) {
  const left = bigrams(a);
  const right = bigrams(b);
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((token) => right.has(token)).length;
  return intersection / (left.size + right.size - intersection);
}

export function clusterProblems(problems) {
  const groups = [];

  for (const problem of problems) {
    const match = groups.find((group) => {
      if (group.category && problem.problem_category && group.category !== problem.problem_category) return false;
      return similarity(group.representative, problem.problem_summary) >= 0.32;
    });

    if (match) {
      match.items.push(problem);
      continue;
    }

    groups.push({
      representative: problem.problem_summary || '',
      category: problem.problem_category,
      items: [problem],
    });
  }

  let groupNumber = 0;
  return groups.flatMap((group) => {
    groupNumber += 1;
    const groupName = `이번 수집 ${String(groupNumber).padStart(2, '0')}: ${group.representative}`;
    return group.items.map((problem) => ({
      ...problem,
      problem_group: groupName,
      // AI 유사군은 독립 원문·사건의 증거 수가 아니다. 이 필드는 사람이 직접
      // 원문을 판독했을 때만 늘릴 수 있으므로 자동 수집에서는 0으로 둔다.
      evidence_count: 0,
      similar_candidate_count: group.items.length,
    }));
  });
}
