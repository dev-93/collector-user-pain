/**
 * index.js
 * Problem Radar 메인 엔트리포인트
 *
 * 실행 방법:
 *   node --env-file=.env src/index.js            — 봇 모드 (기본)
 *   node --env-file=.env src/index.js --collect  — 외부 자동 수집 비활성 상태 확인
 *   node --env-file=.env src/index.js --top      — TOP 10 터미널 출력
 *   node --env-file=.env src/index.js --validate — TOP 문제에서 검증 가설 자동 생성
 *   node --env-file=.env src/index.js --valstat  — 검증 실험실 현황 조회
 */

import 'dotenv/config';
import NotionService from './services/notion-service.js';
import ValidationService from './services/validation-service.js';
import ProblemRadarBot from './services/telegram-bot.js';

const args = process.argv.slice(2);
const mode = args.find((a) => a.startsWith('--'))?.replace('--', '') || 'bot';

async function runCollect() {
  console.log('\n⏸️  외부 자동 수집은 비활성화되어 있습니다.\n');
  console.log('네이버 지식iN·Perplexity를 호출하지 않습니다.');
  console.log('Telegram에서 [문제] 또는 [제보]로 확인한 원문·관찰을 직접 넣어 주세요.');
}

async function runTop() {
  const notion = new NotionService();
  const problems = await notion.getTopProblems(10);

  console.log('\n🔥 Problem Radar — TOP 10\n');

  if (problems.length === 0) {
    console.log('저장된 문제가 없습니다. Telegram에서 [문제] 또는 [제보]로 직접 기록하세요.');
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
