/**
 * setup-validation-db.js
 * Business HQ 페이지에 '🧪 사업 검증 실험실 (Validation Lab)' DB를 인라인으로 생성하고
 * 기존 '문제 수집함' DB와 Relation으로 연결합니다.
 */

import { Client } from '@notionhq/client';
import 'dotenv/config';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const PARENT_PAGE_ID = '3d4eb931-12d5-8181-82cf-e003d245bcb0'; // Business HQ 페이지 ID
const PROBLEM_DB_ID = process.env.NOTION_PROBLEM_DB_ID || '3d4eb931-12d5-8105-8c2b-e57a63dad894';

async function createValidationDB() {
  console.log('🧪 사업 검증 실험실 (Validation Lab) DB 생성 중...');

  const db = await notion.databases.create({
    parent: { type: 'page_id', page_id: PARENT_PAGE_ID },
    title: [{ type: 'text', text: { content: '🧪 사업 검증 실험실 (Validation Lab)' } }],
    icon: { type: 'emoji', emoji: '🧪' },
    is_inline: true,
    properties: {
      // 1. 실험명 / 가설
      name: {
        title: {},
      },
      // 2. 연결된 문제 (Problem DB와 Relation)
      problem: {
        relation: {
          database_id: PROBLEM_DB_ID,
          type: 'single_property',
          single_property: {},
        },
      },
      // 3. 검증 방법론 (Method)
      method: {
        select: {
          options: [
            { name: '1. 커뮤니티 나눔 테스트 (블라인드/카페)', color: 'blue' },
            { name: '2. 1:1 수동 대행 (당근/크몽/컨시어지)', color: 'green' },
            { name: '3. 가짜문 랜딩페이지 (사전예약)', color: 'purple' },
            { name: '4. 과거 행동 인터뷰 (The Mom Test)', color: 'orange' },
            { name: '5. 유료 소액 결제 테스트', color: 'red' },
          ],
        },
      },
      // 4. 검증 채널 (Channel)
      channel: {
        select: {
          options: [
            { name: '블라인드', color: 'red' },
            { name: '네이버 카페', color: 'green' },
            { name: '당근마켓', color: 'orange' },
            { name: '크몽/숨고', color: 'yellow' },
            { name: '쓰레드/인스타', color: 'pink' },
            { name: '오픈카톡방', color: 'yellow' },
            { name: '직접/지인', color: 'gray' },
          ],
        },
      },
      // 5. 검증 진행 상태 (Status)
      status: {
        status: {
          options: [
            { name: '가설 수립', color: 'gray' },
            { name: '실험 진행중', color: 'yellow' },
            { name: '검증 통과 (Go)', color: 'green' },
            { name: '피봇 필요 (Pivot)', color: 'orange' },
            { name: '폐기 (Kill)', color: 'red' },
          ],
        },
      },
      // 6. 목표 검증 지표 (Target Metric)
      target_metric: {
        rich_text: {},
      },
      // 7. 실제 달성 결과 (Actual Result)
      actual_result: {
        rich_text: {},
      },
      // 8. 배운 점 & 회고 (Learning & Decision)
      learnings: {
        rich_text: {},
      },
      // 9. 실험 시작일
      start_date: {
        date: {},
      },
    },
  });

  console.log(`✅ Validation DB 생성 완료: ${db.id}`);
  console.log(`   URL: ${db.url}`);
  return db.id;
}

async function seedPlaybookTemplates(dbId) {
  console.log('🌱 검증 방법론 표준 플레이북 템플릿 등록 중...');

  const templates = [
    {
      name: '[플레이북 1] 블라인드/카페 무료 템플릿 나눔 반응 테스트',
      method: '1. 커뮤니티 나눔 테스트 (블라인드/카페)',
      channel: '블라인드',
      status: '가설 수립',
      target_metric: '조회수 500회 + 쪽지/댓글 신청 10명 이상',
      actual_result: '실제 신청자 수 기록',
      learnings: '방법: "이거 엑셀로 하느라 귀찮아서 자동화 툴 만들었는데 무료로 공유합니다" 글 작성',
    },
    {
      name: '[플레이북 2] 당근마켓/크몽 5,000원 1:1 수작업 대행 테스트',
      method: '2. 1:1 수동 대행 (당근/크몽/컨시어지)',
      channel: '당근마켓',
      status: '가설 수립',
      target_metric: '채팅 문의 3건 이상 + 1건 유료 결제',
      actual_result: '실제 지불 여부 기록',
      learnings: '방법: 코딩 없이 "○○ 대신 처리해드립니다 (5,000원)" 서비스 등록 후 실제 수요 확인',
    },
    {
      name: '[플레이북 3] 노션/쓰레드 초간단 사전예약(Waitlist) 테스트',
      method: '3. 가짜문 랜딩페이지 (사전예약)',
      channel: '쓰레드/인스타',
      status: '가설 수립',
      target_metric: '이메일/연락처 등록 20명 달성',
      actual_result: '등록자 전환율 기록',
      learnings: '방법: 제품 없이 한 장짜리 소개 노션 페이지 만들고 "사전예약 시 50% 할인" 버튼 배치',
    },
  ];

  for (const t of templates) {
    await notion.pages.create({
      parent: { database_id: dbId },
      properties: {
        name: { title: [{ text: { content: t.name } }] },
        method: { select: { name: t.method } },
        channel: { select: { name: t.channel } },
        status: { status: { name: t.status } },
        target_metric: { rich_text: [{ text: { content: t.target_metric } }] },
        actual_result: { rich_text: [{ text: { content: t.actual_result } }] },
        learnings: { rich_text: [{ text: { content: t.learnings } }] },
        start_date: { date: { start: new Date().toISOString().split('T')[0] } },
      },
    });
  }

  console.log('✅ 검증 플레이북 템플릿 3종 시딩 완료');
}

async function main() {
  try {
    const valDbId = await createValidationDB();
    await seedPlaybookTemplates(valDbId);
    console.log(`\n🎉 완료! .env에 아래 내용을 추가하세요:\nNOTION_VALIDATION_DB_ID=${valDbId}`);
  } catch (err) {
    console.error('❌ 오류 발생:', err.message);
  }
}

main();
