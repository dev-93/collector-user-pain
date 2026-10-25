# 게시판 직접 탐색 접근성·이용 조건 1차 조사

2026-10-25. 담당 `/root/discovery_feasibility`. 공개 웹 페이지의 수동 조사만 수행했다. 별도 크롤러 실행·로그인·우회·유료 호출·운영 등록·메시지 발송은 하지 않았다. 본 문서는 운영 수집 허가서나 법률 판단이 아니다.

## 결론

게시판 목록을 직접 읽어 URL을 발견하는 기술 경로는 존재한다. 당근 홈 3곳도 이번 웹 도구에서 글 목록·링크가 보였다. 그러나 본문 판독·7일 판정·자동 이용 허용이 모두 확인된 것은 아니다. 공개 접근 실패와 정책상 불허를 혼동하지 않는다. 이번 조사만으로 즉시 자동 수집 운영을 승인할 수 있는 출처는 확정하지 못했다.

## 확인한 공식 페이지

| 출처 | 직접 확인한 접근 결과 | 정책·용도 판단 | 다음 작업 |
|---|---|---|---|
| 당근 카페 3곳 | [대한민국 자영업 커뮤니티](https://cafe.daangn.com/x6idgz), [사장님들끼리](https://cafe.daangn.com/sajangnimdeulkk), [자영업 고민해결소](https://cafe.daangn.com/jayeong-eob-gom) 홈에서 게시판·게시글 링크를 읽을 수 있었다. 이 조사에서는 글 본문을 열지 않았다. 도구가 5일 전 캐시로 표시한 홈도 있어 현재 실시간 목록으로 단정 불가 | [약관 시도 경로](https://www.daangn.com/policy/terms/)는403, [robots](https://cafe.daangn.com/robots.txt)는 도구 접근 실패. 이것은 전면 금지 근거도 허용 근거도 아니다. 기존 프로젝트의 당근 자동 접근·AI 전송 금지 유지 | 공식 최신 약관과 카페 적용 범위를 확인하고 운영자/플랫폼에 소량 자동 탐색 허용 범위 문의 |
| Pressure Washing Resource | [최신 활동 목록](https://pressurewashingresource.com/community/latest)이 읽힘. [개별 글 예시](https://pressurewashingresource.com/community/t/waterboss-gun-please-stop/41149) 본문도 읽힘. 목록의 Activity는 원글 작성일이 아니므로 새 글 판정에 사용하면 안 됨 | [공식 이용약관](https://pressurewashingresource.com/community/tos)은 기여글 CC BY-NC-SA3.0. 회사명 미치환 템플릿도 남아 있음. 사업 탐색을 위한 자동 읽기·외부 AI 처리 허용을 확정하지 못함 | 업계 현장 작업자 경험 관찰 후보. 일반 소비자/비용 결정자 경험과 구분. 운영 허가 확인 전 어댑터 활성화 금지 |
| UK Business Forums | [Recent Posts](https://www.ukbusinessforums.co.uk/aud-feeds/12)가 읽힘. 새 답글·AI 보조 답변·홍보 글이 섞여 있어 원글과 분리 필요 | [공식 약관](https://www.ukbusinessforums.co.uk/help/terms-conditions/)은 개인적 발췌 다운로드와 commercial use를 구분하며 상업 이용에 라이선스 요구. 공개 페이지가 읽힌다는 이유로 운영 자동수집 허용이라 볼 수 없음 | 원글 작성일·작성자 직접 경험·AI 답변 식별을 설계하고 목적별 허가 문의 |
| Open Food Network Community | [홈](https://community.openfoodnetwork.org/)에서 목록을 읽음. 농식품 허브 운영·배달·주문 관련 범주가 있으나 기술 개발 글 비중도 큼. `/latest` 도구 접근 실패와 홈 접근 성공이 함께 존재 | [공식 포럼 약관](https://community.openfoodnetwork.org/tos)은 CC BY-NC-SA3.0. [Community Pledge](https://community.openfoodnetwork.org/t/community-pledge-v2-january-2020/1847)는 일부 sector development 자료를 CC BY-SA4.0으로 공개하지만 이를 모든 포럼 글에 확대 적용하면 안 됨 | 자료 종류별 라이선스 확인. 목적 적합성·최신성 모두 추가 검토, 주력 출처 확정 아님 |
| Mumsnet Housekeeping | [목록 페이지](https://www.mumsnet.com/talk/housekeeping)는 열렸으나 이번 추출 결과에 실제 글 목록이 없었음 | [약관 시도 경로](https://www.mumsnet.com/info/terms-of-use) 도구 접근 실패. 허용/불허 미확인 | 가사·청소 이용자 경험 가능성은 가설. 자동 접근 승인 후보로 등록하지 않음 |
| 국내 대안: 뽐뿌 고민포럼 | [목록](https://www.ppomppu.co.kr/zboard/zboard.php?id=problem)은 이번 도구에서403, [robots](https://www.ppomppu.co.kr/robots.txt)·[규정 시도 경로](https://www.ppomppu.co.kr/rules.php)는 접근 실패 | 도구 접근 오류이며 멤버 전용이나 약관상 금지라고 단정할 수 없음. 고객 역할 적합성도 미검증 | 차단 우회하지 않음. 접근 가능한 공식 경로·운영 조건을 확인하기 전 제외 |
| 국내 대안: 네이버 카페 아프니까 사장이다 | [홈](https://cafe.naver.com/jihosoccer) 도구 접근 실패 | 가입·회원 전용 여부와 일반 도구 접근 오류를 구분하지 못함. 원문과 허용 조건 미확인 | 무리하게 수집기를 만들지 않음. 플랫폼의 승인된 제공 경로 존재 여부 별도 확인 |

당근의 [부동산 약관 FAQ](https://www.daangn.com/wv/faqs/35401)에는 승인 없는 크롤링 제한이 있지만, 부동산 서비스 조항을 카페에 그대로 적용하는 근거로 쓰지 않는다. [카페 등급 안내](https://www.daangn.com/wv/faqs/35937)는 게시판별 열람 등급 설정이 있음을 확인해 준다. 전체 카페가 공개 또는 비공개라고 일반화할 수 없다.

## 탐색 구현에 필요한 검증

- 목록 Activity/최신 답글 시각과 `원글 작성일`을 별개 필드로 유지한다. 처음 본 글이 최근 작성된 글이라는 뜻은 아니다.
- 목록 링크만 확보한 자료는 `discovered`, 본문 접근 성공은 `opened`, 날짜 확인은 `date_verified`로 분리한다. 오류는 `membership_required`, `http_error`, `tool_extraction_failed`, `date_unknown` 등 실제 확인한 범위만 기록한다.
- URL/글 ID는 재발견 방지에 사용한다. 작성자·사건 단위 독립성은 별도 사람 검토 없이는 확정하지 않는다.
- 공개 글 링크/짧은 발췌 보고, 본문 영구 저장, 외부 AI 전송은 목적·영향이 다르다. 한 항목의 허용을 나머지 전체 허용으로 확대하지 않는다.
- 이번에 보인 목록은 탐색 경로 실증이며 유용한 고객 문제 수나 사업 수요의 증거가 아니다.

## 허용 범위 문의 초안 — 미발송

> 안녕하세요. 개인 사업 탐색을 위한 비공개 조사 도구를 검토하고 있습니다. 로그인 없이 공개된 지정 게시판의 첫 목록 페이지만 하루 1회 확인하고, 신규 글의 URL·제목·게시일 및 짧은 발췌를 제 개인 Telegram으로 보고하려 합니다. 회원 전용 글·연락처 수집·영업 연락·재판매·공개 재배포는 하지 않습니다. 목록 및 신규 본문을 자동 요청하는 것이 가능한지, 허용 경로·빈도·표시 방식·보관 기간을 알려주실 수 있을까요? 본문을 외부 AI API로 전송해 요약하는 기능은 별도 허용을 받은 경우에만 사용하겠습니다. 허용되지 않는 범위가 있다면 해당 부분을 비활성화하겠습니다.

문의는 초안일 뿐 발송하지 않았다. 실제 요청량·보관 기간은 운영 설계를 확정한 후 구체화해야 한다.
