/**
 * index.js
 * Problem Radar 메인 엔트리포인트
 *
 * 실행 방법:
 *   node --env-file=.env src/index.js            — 봇 모드 (기본)
 *   node --env-file=.env src/index.js --collect  — 1회 수집 + 분석 후 종료
 *   node --env-file=.env src/index.js --top      — TOP 10 터미널 출력
 *   node --env-file=.env src/index.js --validate — TOP 문제에서 검증 가설 자동 생성
 *   node --env-file=.env src/index.js --valstat  — 검증 실험실 현황 조회
 */

import 'dotenv/config';
import NaverCollector from './collectors/naver-kin.js';
import AppReviewCollector from './collectors/app-reviews.js';
import AIAnalyzer from './services/ai-analyzer.js';
import NotionService from './services/notion-service.js';
import ValidationService from './services/validation-service.js';
import ProblemRadarBot from './services/telegram-bot.js';
import { preFilter } from './utils/pre-filter.js';
import { clusterProblems } from './utils/problem-cluster.js';
import { FREE_TIER_AI_LIMIT, MIN_SCORE } from './config/index.js';

const args = process.argv.slice(2);
const mode = args.find((a) => a.startsWith('--'))?.replace('--', '') || 'bot';

async function runCollect() {
  console.log('\n🚀 Problem Radar — 수집 + 분석 모드\n');

  const naverCollector = new NaverCollector();
  const appCollector = new AppReviewCollector();
  const analyzer = new AIAnalyzer();
  const notion = new NotionService();

  // 점수는 저장 기준이 아니라 터미널 검토 후보를 줄이는 보조 신호다.
  const minScore = MIN_SCORE;

  // 1. 수집
  console.log('=== STEP 1: 수집 ===');
  const [naverResults, appResults] = await Promise.allSettled([
    naverCollector.collect(),
    appCollector.collect(),
  ]);

  const rawCandidates = [
    ...(naverResults.status === 'fulfilled' ? naverResults.value : []),
    ...(appResults.status === 'fulfilled' ? appResults.value : []),
  ];

  console.log(`\n원본 수집: ${rawCandidates.length}건`);

  if (rawCandidates.length === 0) {
    console.log('수집된 항목이 없습니다. 종료.');
    return;
  }

  // 2. 사전 필터 (규칙 기반, 0 토큰)
  console.log('=== STEP 2: 사전 필터 (토큰 절감) ===');
  const candidates = preFilter(rawCandidates, {
    minPreScore: 40,  // 가벼운 불평 제외 — 구조적 문제만 통과
    maxCount: 10,  // 무료 AI 한 배치 5건을 위한 후보 버퍼
    verbose: true,
  });

  if (candidates.length === 0) {
    console.log('사전 필터 통과 항목이 없습니다. 수집 키워드 조정을 고려하세요.');
    return;
  }

  // 3. AI 분석 — 무료 티어 기본 한 배치(5건). 나머지는 저장하지 않는 규칙 후보이다.
  console.log('=== STEP 3: AI 분석 ===');
  const analyzed = clusterProblems(await analyzer.analyzeAll(candidates, {
    minScore,
    allowIndividualFallback: false,
  }));

  // 4. 사용자가 직접 실행한 수집 결과만 Notion에 자동 저장한다.
  const toSave = analyzed
    .filter((p) => p.analysis_status === 'ai_analyzed' && p.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, FREE_TIER_AI_LIMIT);

  console.log('=== STEP 4: Notion 저장 ===');
  if (toSave.length === 0) {
    console.log(`점수 ${minScore}+ AI 분석 항목이 없어 Notion 저장을 건너뜁니다.`);
  } else {
    console.log(`💾 Notion 저장 대상: ${toSave.length}건`);
    await notion.saveAll(toSave, minScore);
  }

  printReviewCandidates(toSave);

  console.log('✅ 완료');
}

function printReviewCandidates(problems) {
  const candidates = problems
    .filter((p) => (
      p.evidence_quote
      && p.target_user
    ))
    .sort((a, b) => b.score - a.score)
    .slice(0, FREE_TIER_AI_LIMIT);

  console.log('\n=== 🔎 저장된 항목의 근거 점검 ===\n');

  if (candidates.length === 0) {
    console.log('저장된 항목 중 원문 인용과 고객 정보가 모두 있는 항목이 없습니다. 규칙을 점검하세요.');
    return;
  }

  candidates.forEach((p, i) => {
    console.log(`${i + 1}. ${p.problem_summary}`);
    console.log(`   고객: ${p.target_user}`);
    console.log(`   원문 근거: “${p.evidence_quote}” (${p.evidence_type})`);
    console.log(`   링크: ${p.source_url || '-'}`);
    console.log(`   다음: 같은 고객·상황·임시방편의 독립 원문 2개를 직접 확인하세요.`);
    if ((p.evidence_count || 1) > 1) {
      console.log(`   참고: 이번 실행의 AI 유사군 ${p.evidence_count}건 — 아직 증거 ${p.evidence_count}개로 간주하지 않습니다.`);
    }
    console.log();
  });
}

async function runTop() {
  const notion = new NotionService();
  const problems = await notion.getTopProblems(10);

  console.log('\n🔥 Problem Radar — TOP 10\n');

  if (problems.length === 0) {
    console.log('저장된 문제가 없습니다. --collect 를 먼저 실행하세요.');
    return;
  }

  problems.forEach((p, i) => {
    console.log(`${i + 1}. [${p.score}점] ${p.problem_summary}`);
    console.log(`   ${p.source || '-'} | ${p.problem_category || '기타'} | 상태: ${p.status || '-'}`);
    console.log(`   URL: ${p.notion_url}`);
    console.log();
  });
}

async function runBot() {
  console.log('\n🤖 Problem Radar 봇 모드 시작\n');
  new ProblemRadarBot();
}

/**
 * TOP 문제에서 검증 가설 자동 생성
 * 점수 70+ 수집됨 상태의 문제를 Notion 검증 DB에 등록
 */
async function runValidate() {
  console.log('\n🧪 Problem Radar — 검증 가설 자동 생성\n');

  const notion = new NotionService();
  const validation = new ValidationService();

  // TOP 20 문제 조회
  const problems = await notion.getTopProblems(20);
  console.log(`📋 조회된 문제: ${problems.length}건 (score 70+ 필터링 후 검증 가설 생성)`);

  await validation.autoCreateFromProblems(problems, 5);

  console.log('\n✅ 완료 — Notion 검증 실험실에서 확인하세요.');
}

/**
 * 검증 실험실 현황 조회
 */
async function runValStat() {
  console.log('\n📊 Problem Radar — 검증 실험실 현황\n');

  const validation = new ValidationService();

  const [stats, active] = await Promise.all([
    validation.getStats(),
    validation.getActiveExperiments(),
  ]);

  console.log(`전체 실험: ${stats.total}건`);
  console.log(`  ✅ Go (통과): ${stats.go}건`);
  console.log(`  🔄 Pivot 필요: ${stats.pivot}건`);
  console.log(`  ❌ Kill (폐기): ${stats.kill}건`);
  console.log(`  🔬 진행중/가설: ${stats.inProgress}건`);

  if (active.length > 0) {
    console.log('\n⏳ 현재 진행 중인 실험:');
    active.forEach((exp, i) => {
      console.log(`  ${i + 1}. [${exp.status}] ${exp.name}`);
      console.log(`     채널: ${exp.channel} | 목표: ${exp.target_metric}`);
      console.log(`     Notion: ${exp.notion_url}`);
    });
  } else {
    console.log('\n진행 중인 실험이 없습니다. --validate 로 생성하세요.');
  }
}

// 실행
switch (mode) {
  case 'collect':
    runCollect().catch((err) => {
      console.error('❌ 오류:', err.message);
      process.exit(1);
    });
    break;

  case 'top':
    runTop().catch((err) => {
      console.error('❌ 오류:', err.message);
      process.exit(1);
    });
    break;

  case 'validate':
    runValidate().catch((err) => {
      console.error('❌ 오류:', err.message);
      process.exit(1);
    });
    break;

  case 'valstat':
    runValStat().catch((err) => {
      console.error('❌ 오류:', err.message);
      process.exit(1);
    });
    break;

  case 'bot':
  default:
    runBot().catch((err) => {
      console.error('❌ 봇 시작 실패:', err.message);
      process.exit(1);
    });
}
