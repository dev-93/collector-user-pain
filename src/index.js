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

const args = process.argv.slice(2);
const mode = args.find((a) => a.startsWith('--'))?.replace('--', '') || 'bot';

async function runCollect() {
  console.log('\n🚀 Problem Radar — 수집 + 분석 모드\n');

  const naverCollector = new NaverCollector();
  const appCollector = new AppReviewCollector();
  const analyzer = new AIAnalyzer();
  const notion = new NotionService();

  // MIN_SCORE: 70번이상만 Notion 저장 (DB 과적 방지)
  const minScore = parseInt(process.env.MIN_SCORE) || 70;

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
    minPreScore: 40,
    maxCount: 50,  // Gemini Free: 15 RPM → 50건 기준 약 5분 소요
    verbose: true,
  });

  if (candidates.length === 0) {
    console.log('사전 필터 통과 항목이 없습니다. 수집 키워드 조정을 고려하세요.');
    return;
  }

  // 3. AI 분석 (preFilter 통과 한 것만)
  console.log('=== STEP 3: AI 분석 ===');
  const analyzed = await analyzer.analyzeAll(candidates, { minScore });

  // 4. Notion 저장 (score 70+ 만)
  console.log('=== STEP 4: Notion 저장 ===');
  await notion.saveAll(analyzed, minScore);

  // 5. TOP 10 출력
  console.log('\n=== 🔥 TOP 10 문제 ===\n');
  const top10 = analyzed
    .filter((p) => p.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  if (top10.length === 0) {
    console.log(`점수 ${minScore}+ 문제가 없었습니다.`);
  } else {
    top10.forEach((p, i) => {
      const estimated = p.is_estimated ? ' (추정)' : '';
      console.log(`${i + 1}. [${p.score}점${estimated}] ${p.problem_summary}`);
      console.log(`   대상: ${p.target_user} | 카테고리: ${p.problem_category}`);
      console.log(`   빈도:${p.frequency} 고통:${p.pain} 지불의사:${p.willingness_to_pay} 내적합도:${p.my_fit}`);
      if (p.mvp_idea) console.log(`   💡 ${p.mvp_idea}`);
      console.log();
    });
  }

  console.log('✅ 완료');
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
    const estimated = p.is_estimated ? ' (추정)' : '';
    console.log(`${i + 1}. [${p.score}점${estimated}] ${p.problem_summary}`);
    console.log(`   ${p.source} | ${p.problem_category} | 상태: ${p.status}`);
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
