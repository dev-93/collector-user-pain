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

// 태남 무기 정의 (AI 적합도 판단용)
export const MY_WEAPONS = {
  skills: [
    'Vue', 'TypeScript', 'SvelteKit', '웹앱 제작',
    '모바일 앱 연계', 'API 연동', '크롤링', '데이터 처리',
    'AI 활용', '자동화',
  ],
  experience: [
    '대형 서비스 개발', '실사용자 다수 서비스',
    'UX/성능 개선', '서비스 운영',
  ],
  domain: [
    '미국 주식', 'UAM', '항공', '언어 학습',
  ],
  advantages: [
    '개발 시간 직접 투입 가능',
    'AI로 개발 속도 향상',
    '콘텐츠 제작 가능',
    '커뮤니티 운영 경험',
  ],
  // TODO: 앞으로 채워야 할 무기
  todo: [
    '고객 인터뷰 경험',
    '영업/마케팅',
    'MVP 검증 반복',
    '결제 전환 최적화',
  ],
};

// 수집 설정
export const COLLECT_CONFIG = {
  naver: {
    // 검색할 키워드 조합 (문제 도메인 + 불평 신호)
    searchQueries: [
      '방법이 없나 불편',
      '매번 이렇게 해야 귀찮',
      '왜 이런 기능이 없',
      '대신 해주는 곳 없나',
      '엑셀로 직접 불편',
      '자동으로 안 되나',
      '한곳에서 불편',
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
