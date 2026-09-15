// AI 분석 설정
export const AI_CONFIG = {
  // 폴백 체인 순서: OpenRouter → Groq → Gemini
  openrouter: {
    model: 'google/gemma-4-26b-a4b-it:free',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  groq: {
    // 우선 모델 → 404 시 fallbackModel 순으로 시도
    // (이 계정에서 llama 모델 접근 불가 — openai/gpt-oss 사용)
    // gpt-oss-120b: JSON 지시 준수 + 보수적 평가 → 이 프로젝트에 가장 적합
    // gpt-oss-20b: 경량 폴백용
    model: 'openai/gpt-oss-120b',
    fallbackModel: 'openai/gpt-oss-20b',
    baseUrl: 'https://api.groq.com/openai/v1',
  },
  gemini: {
    // Gemini 2.0 Flash는 2026-06-01 종료됨. Google의 공식 대체 모델 사용.
    model: 'gemini-3.6-flash',
  },
};

// 최소 점수 (이 이상만 Notion 저장 / TOP 10 출력)
export const MIN_SCORE = 70;

// 무료 티어에서는 한 번의 수동 수집에 한 배치(최대 5건)만 분석한다.
export const FREE_TIER_AI_LIMIT = 5;

// 불평 시그널 키워드 — 이 표현이 원석이다
export const COMPLAINT_SIGNALS = [
  '방법이 없나',
  '방법이 없을까',
  '너무 불편',
  '불편하다',
  '불편해요',
  '매번 이렇게',
  '매번 해야',
  '왜 이런 기능',
  '왜 안 되',
  '왜 이렇게',
  '대신 해주는 곳',
  '대신 해주는 서비스',
  '이거 해주는 곳',
  '어디서 해야',
  '어디서 해야 하는지',
  '시간이 너무',
  '너무 오래 걸',
  '엑셀로 매번',
  '수작업으로',
  '사람이 직접',
  '귀찮',
  '번거롭',
  '복잡해',
  '왜 이렇게 어렵',
  '자동으로 안 되',
  '자동화',
  '통합해주는',
  '한곳에서',
  '한 곳에서',
];

// 문제 카테고리
export const PROBLEM_CATEGORIES = [
  '정보 탐색',
  '행정/서류',
  '예약/스케줄',
  '결제/금융',
  '의사소통',
  '반복 작업',
  '비교/선택',
  '배움/교육',
  '이동/물류',
  '건강/의료',
  '육아/가족',
  '직장/업무',
  '기타',
];

// 점수 공식 가중치
export const SCORE_WEIGHTS = {
  frequency: 0.20,      // 빈도
  pain: 0.20,           // 고통 정도
  willingness_to_pay: 0.20,  // 지불 의사
  market_size: 0.15,    // 시장 크기
  competition_gap: 0.10, // 경쟁 기회
  my_fit: 0.15,         // 내 해결 능력
};

// 개발 난이도는 별도 감점으로 계산한다. 모든 점수는 최종적으로 0~100으로 정규화한다.
export const DEVELOPMENT_PENALTY_WEIGHT = 0.10;

// 나의 역량 정의 (AI 적합도 판단용 — 특정 도메인 편향 없이 범용적 문제 해결력 중심)
export const MY_WEAPONS = {
  skills: [
    '웹/모바일 서비스 구축', 'API 연동 및 크롤링', 'AI 기반 자동화 및 문제 분석',
    '빠른 프로토타이핑 및 MVP 제작',
  ],
  experience: [
    '신규 서비스 기획 및 개발', '사용자 경험(UX) 최적화', '실사용 서비스 운영',
  ],
  domain: [
    '전 도메인 범용 (직장인 불편, 반복 수작업, 행정/서류, 정보 탐색 등)',
  ],
  advantages: [
    '빠른 실행력 및 즉각적 개발 투입 가능',
    'AI를 활용한 고속 개발',
  ],
};

// 수집 설정
export const COLLECT_CONFIG = {
  naver: {
    // 검색할 키워드 조합 (문제 도메인 + 불평 신호)
    searchQueries: [
      // 반복 수작업 고통
      '엑셀로 매번 해야 불편',
      '수작업으로 직접 입력 귀찮',
      '매번 일일이 따로 해야',
      // 기능 부재 / 구조적 불편
      '왜 이런 기능이 없나',
      '자동으로 안 되나 불편',
      '한곳에서 안 되나',
      '대신 해주는 서비스 없나',
      // 반복 비용/시간 낭비
      '매달 직접 해야 번거롭',
      '시간이 너무 오래 걸려',
      // 행정/서류/정보 탐색 구조적 문제
      '어디서 해야 하는지 모르겠',
      '방법이 없나 통합',
    ],
    displayCount: 10, // 쿼리당 수집 건수
  },
  apps: {
    // 수집할 앱 목록 (경쟁 앱 분석용)
    // TODO: 관심 도메인 확정 후 추가
    targets: [
      { store: 'google', id: 'com.kakao.talk', name: '카카오톡' },
      { store: 'google', id: 'com.nhn.android.search', name: '네이버' },
      { store: 'google', id: 'com.baemin.android', name: '배달의민족' },
    ],
    minRating: 1,
    maxRating: 2,
    count: 50,
  },
};
