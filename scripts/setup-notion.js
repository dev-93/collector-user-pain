/**
 * setup-notion.js
 * Notion에 문제 수집함 DB를 자동으로 생성하는 초기화 스크립트
 *
 * 사용법:
 *   node --env-file=.env scripts/setup-notion.js
 *
 * 실행 전 필요:
 *   1. .env 파일에 NOTION_TOKEN 설정
 *   2. Notion에서 통합(Integration) 생성 후 부모 페이지에 연결
 *   3. .env에 NOTION_PARENT_PAGE_ID 입력
 *
 * 실행 후:
 *   - 생성된 DB ID를 .env의 NOTION_PROBLEM_DB_ID에 입력
 */

import { Client } from '@notionhq/client';
import 'dotenv/config';

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const PARENT_PAGE_ID = process.env.NOTION_PARENT_PAGE_ID || '';

async function createProblemDB() {
  console.log('📋 문제 수집함 DB 생성 중...');

  const db = await notion.databases.create({
    parent: { type: 'page_id', page_id: PARENT_PAGE_ID },
    title: [{ type: 'text', text: { content: '🔍 문제 수집함' } }],
    icon: { type: 'emoji', emoji: '🔍' },
    properties: {
      '문제': { title: {} },
      '점수': { number: { format: 'number' } },
      '카테고리': {
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
            { name: '건강/의료', color: 'red' },
            { name: '직장/업무', color: 'blue' },
            { name: '기타', color: 'default' },
          ],
        },
      },
      '대상': { rich_text: {} },
      '출처': {
        select: {
          options: [
            { name: '네이버 지식iN', color: 'green' },
            { name: '네이버 블로그', color: 'blue' },
            { name: '구글 뉴스 (웹 수집)', color: 'purple' },
            { name: '구글 플레이', color: 'red' },
            { name: '직접 제보', color: 'pink' },
          ],
        },
      },
      '원문링크': { url: {} },
      '상태': {
        select: {
          options: [
            { name: '수집됨', color: 'gray' },
            { name: '수집됨(규칙)', color: 'default' },
            { name: '검증대상', color: 'blue' },
            { name: '검증완료', color: 'green' },
            { name: '기각', color: 'red' },
          ],
        },
      },
      '수집일': { date: {} },
      '다음 검증 실험': { rich_text: {} },
    },
  });

  console.log(`✅ 문제 수집함 DB 생성 완료: ${db.id}`);
  console.log(`   URL: ${db.url}`);
  return db.id;
}

async function main() {
  if (!process.env.NOTION_TOKEN) {
    console.error('❌ NOTION_TOKEN이 .env에 없습니다.');
    process.exit(1);
  }

  if (!PARENT_PAGE_ID) {
    console.error(`
❌ NOTION_PARENT_PAGE_ID가 .env에 없습니다.

방법:
  1. Notion에서 수집함을 만들 페이지 URL 확인
     예: https://notion.so/Business-HQ-3d4eb93112d58...
  2. URL 마지막 32자리가 페이지 ID
  3. .env에 NOTION_PARENT_PAGE_ID=<ID> 추가 후 재실행
`);
    process.exit(1);
  }

  try {
    const problemDbId = await createProblemDB();
    console.log(`
🎉 완료! .env에 추가하세요:

NOTION_PROBLEM_DB_ID=${problemDbId}
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
