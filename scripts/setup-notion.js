/**
 * setup-notion.js
 * Notion에 Problem DB와 Weapon DB를 자동으로 생성하는 초기화 스크립트
 *
 * 사용법:
 *   node scripts/setup-notion.js
 *
 * 실행 전 필요:
 *   1. .env 파일에 NOTION_TOKEN 설정
 *   2. Notion에서 통합(Integration) 생성 후 부모 페이지에 연결
 *   3. 아래 PARENT_PAGE_ID에 부모 페이지 ID 입력
 *
 * 실행 후:
 *   - 생성된 DB ID를 .env의 NOTION_PROBLEM_DB_ID, NOTION_WEAPON_DB_ID에 입력
 */

import { Client } from '@notionhq/client';
import 'dotenv/config';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

// ⚠️ 여기에 Notion 부모 페이지 ID를 입력하세요
// URL에서 확인: https://notion.so/{workspace}/{페이지이름}-{PARENT_PAGE_ID}
const PARENT_PAGE_ID = process.env.NOTION_PARENT_PAGE_ID || '';

async function createProblemDB() {
  console.log('📋 Problem DB 생성 중...');

  const db = await notion.databases.create({
    parent: { type: 'page_id', page_id: PARENT_PAGE_ID },
    title: [{ type: 'text', text: { content: '🔍 Problem Radar DB' } }],
    icon: { type: 'emoji', emoji: '🔍' },
    properties: {
      // 제목 (문제 요약)
      problem_summary: {
        title: {},
      },
      // 원문
      original_text: {
        rich_text: {},
      },
      // 출처
      source: {
        select: {
          options: [
            { name: '네이버 지식iN', color: 'green' },
            { name: '네이버 블로그', color: 'blue' },
            { name: '네이버 뉴스', color: 'purple' },
            { name: '구글 플레이', color: 'red' },
            { name: '앱스토어', color: 'gray' },
            { name: '커뮤니티', color: 'orange' },
            { name: '상품 리뷰', color: 'yellow' },
            { name: '직접 제보', color: 'pink' },
          ],
        },
      },
      // 원문 URL
      source_url: {
        url: {},
      },
      // 누가 겪는가
      target_user: {
        rich_text: {},
      },
      // 어떤 상황에서 발생하는가
      context: {
        rich_text: {},
      },
      // 문제 유형
      problem_category: {
        select: {
          options: [
            { name: '정보 탐색', color: 'blue' },
            { name: '행정/서류', color: 'red' },
            { name: '예약/스케줄', color: 'green' },
            { name: '결제/금융', color: 'yellow' },
            { name: '의사소통', color: 'purple' },
            { name: '반복 작업', color: 'orange' },
            { name: '비교/선택', color: 'pink' },
            { name: '배움/교육', color: 'gray' },
            { name: '이동/물류', color: 'brown' },
            { name: '건강/의료', color: 'red' },
            { name: '육아/가족', color: 'green' },
            { name: '직장/업무', color: 'blue' },
            { name: '기타', color: 'default' },
          ],
        },
      },
      // 현재 어떻게 해결하고 있는가
      current_solution: {
        rich_text: {},
      },
      // 현재 해결책의 문제
      solution_gap: {
        rich_text: {},
      },
      // 기존 경쟁 서비스
      competitors: {
        rich_text: {},
      },

      // === 점수 필드 (AI가 채움) ===
      // 발생 빈도 (1~10)
      frequency: {
        number: { format: 'number' },
      },
      // 고통 정도 (1~10)
      pain: {
        number: { format: 'number' },
      },
      // 돈을 낼 가능성 (1~10)
      willingness_to_pay: {
        number: { format: 'number' },
      },
      // 시장 크기 (1~10)
      market_size: {
        number: { format: 'number' },
      },
      // 경쟁 기회 (1~10)
      competition_gap: {
        number: { format: 'number' },
      },
      // 내가 해결할 수 있는 정도 (1~10)
      my_fit: {
        number: { format: 'number' },
      },
      // 개발 난이도 (1~10, 낮을수록 쉬움)
      development_difficulty: {
        number: { format: 'number' },
      },
      // 종합 점수 (0~100)
      score: {
        number: { format: 'number' },
      },

      // === 메타 필드 ===
      // 검증 상태
      status: {
        select: {
          options: [
            { name: '수집됨', color: 'gray' },
            { name: '분석중', color: 'yellow' },
            { name: '검증대상', color: 'blue' },
            { name: '인터뷰예정', color: 'purple' },
            { name: '검증완료', color: 'green' },
            { name: '기각', color: 'red' },
          ],
        },
      },
      // AI 추론인지 여부
      is_estimated: {
        checkbox: {},
      },
      // 수집 날짜
      collected_at: {
        date: {},
      },
      // 메모
      memo: {
        rich_text: {},
      },
    },
  });

  console.log(`✅ Problem DB 생성 완료: ${db.id}`);
  console.log(`   URL: ${db.url}`);
  return db.id;
}

async function createWeaponDB() {
  console.log('⚔️  Weapon DB 생성 중...');

  const db = await notion.databases.create({
    parent: { type: 'page_id', page_id: PARENT_PAGE_ID },
    title: [{ type: 'text', text: { content: '⚔️ 태남의 무기 DB' } }],
    icon: { type: 'emoji', emoji: '⚔️' },
    properties: {
      name: { title: {} },
      category: {
        select: {
          options: [
            { name: '기술', color: 'blue' },
            { name: '경험', color: 'green' },
            { name: '도메인 지식', color: 'purple' },
            { name: '자원', color: 'yellow' },
            { name: '앞으로 채울 것', color: 'gray' },
          ],
        },
      },
      proficiency: {
        number: { format: 'number' }, // 1~10
      },
      description: {
        rich_text: {},
      },
    },
  });

  console.log(`✅ Weapon DB 생성 완료: ${db.id}`);
  console.log(`   URL: ${db.url}`);
  return db.id;
}

async function seedWeaponDB(dbId) {
  console.log('🌱 무기 데이터 시드 중...');

  const weapons = [
    // 기술
    { name: 'Vue', category: '기술', proficiency: 9 },
    { name: 'TypeScript', category: '기술', proficiency: 8 },
    { name: 'SvelteKit', category: '기술', proficiency: 8 },
    { name: '웹앱 제작', category: '기술', proficiency: 9 },
    { name: 'API 연동', category: '기술', proficiency: 9 },
    { name: '크롤링/자동화', category: '기술', proficiency: 8 },
    { name: 'AI 활용', category: '기술', proficiency: 8 },
    // 경험
    { name: '대형 서비스 개발 경험', category: '경험', proficiency: 8 },
    { name: '실사용자 다수 서비스 운영', category: '경험', proficiency: 8 },
    { name: 'UX/성능 개선', category: '경험', proficiency: 8 },
    // 도메인
    { name: '미국 주식/UAM', category: '도메인 지식', proficiency: 7 },
    { name: '항공 산업', category: '도메인 지식', proficiency: 6 },
    // 자원
    { name: '직접 개발 시간 투입', category: '자원', proficiency: 10 },
    { name: 'AI 개발 속도 향상', category: '자원', proficiency: 9 },
    // TODO
    { name: '고객 인터뷰', category: '앞으로 채울 것', proficiency: 2 },
    { name: '영업/마케팅', category: '앞으로 채울 것', proficiency: 2 },
    { name: 'MVP 검증 반복', category: '앞으로 채울 것', proficiency: 3 },
  ];

  for (const w of weapons) {
    await notion.pages.create({
      parent: { database_id: dbId },
      properties: {
        name: { title: [{ text: { content: w.name } }] },
        category: { select: { name: w.category } },
        proficiency: { number: w.proficiency },
      },
    });
  }

  console.log(`✅ ${weapons.length}개 무기 시드 완료`);
}

async function main() {
  if (!process.env.NOTION_TOKEN) {
    console.error('❌ NOTION_TOKEN이 .env에 없습니다.');
    process.exit(1);
  }

  if (!PARENT_PAGE_ID) {
    console.error(`
❌ PARENT_PAGE_ID가 설정되지 않았습니다.

방법:
  1. Notion에서 새 페이지를 만드세요 (예: "Problem Radar")
  2. 통합(Integration)을 해당 페이지에 연결하세요
  3. 페이지 URL에서 마지막 32자리를 복사하세요
     예: https://notion.so/Problem-Radar-[여기가 ID]
  4. .env에 NOTION_PARENT_PAGE_ID=<복사한 ID> 추가 후 재실행

또는 scripts/setup-notion.js의 PARENT_PAGE_ID 변수에 직접 입력하세요.
`);
    process.exit(1);
  }

  try {
    const problemDbId = await createProblemDB();
    const weaponDbId = await createWeaponDB();
    await seedWeaponDB(weaponDbId);

    console.log(`
🎉 Notion 초기화 완료!

다음을 .env에 추가하세요:

NOTION_PROBLEM_DB_ID=${problemDbId}
NOTION_WEAPON_DB_ID=${weaponDbId}
`);
  } catch (err) {
    console.error('❌ 오류:', err.message);
    if (err.code === 'object_not_found') {
      console.error('페이지를 찾을 수 없습니다. Integration이 해당 페이지에 연결되었는지 확인하세요.');
    }
    process.exit(1);
  }
}

main();
