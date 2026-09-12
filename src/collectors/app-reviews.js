/**
 * app-reviews.js
 * 구글 플레이 / 앱스토어에서 저점수 리뷰(★1~2)를 수집한다
 *
 * 경쟁 앱의 약점 = 아직 해결 안 된 문제 = 사업 기회
 *
 * 주의:
 *   google-play-scraper / app-store-scraper는 비공식 스크래핑 라이브러리입니다.
 *   프로토타입 용도로 사용하며, 상업적 규모 사용 시 정책 재검토가 필요합니다.
 *
 * TODO: 수집 앱 목록을 src/config/index.js COLLECT_CONFIG.apps.targets에 추가
 */

import gplay from 'google-play-scraper';
import appStore from 'app-store-scraper';
import { COMPLAINT_SIGNALS, COLLECT_CONFIG } from '../config/index.js';

function extractSignals(text) {
  return COMPLAINT_SIGNALS.filter((s) => text && s && text.includes(s));
}

class AppReviewCollector {
  /**
   * 구글 플레이 저점수 리뷰 수집
   * @param {string} appId - 패키지명 (예: com.baemin.android)
   * @param {string} appName
   */
  async collectGooglePlay(appId, appName) {
    const results = [];

    try {
      const reviews = await gplay.reviews({
        appId,
        sort: gplay.sort.NEWEST,
        num: COLLECT_CONFIG.apps.count,
        lang: 'ko',
        country: 'kr',
      });

      const items = Array.isArray(reviews) ? reviews : reviews?.data || [];

      for (const review of items) {
        // 저점수만 (★1~2)
        if (review.score > COLLECT_CONFIG.apps.maxRating) continue;

        const text = review.text || '';
        const signals = extractSignals(text);

        results.push({
          source: '구글 플레이',
          source_url: `https://play.google.com/store/apps/details?id=${appId}`,
          original_text: `[앱] ${appName} ★${review.score}\n${text}`,
          raw_title: appName,
          raw_description: text,
          app_id: appId,
          app_name: appName,
          rating: review.score,
          signals,
          // 시그널이 없어도 저점수 리뷰는 일단 수집 (AI가 분석)
          collected_at: new Date().toISOString(),
        });
      }

      console.log(`  구글플레이 [${appName}]: ${items.length}건 → 저점수 ${results.length}건`);
    } catch (err) {
      console.error(`❌ 구글플레이 [${appName}] 수집 실패:`, err.message);
    }

    return results;
  }

  /**
   * 앱스토어 저점수 리뷰 수집
   * @param {number} appId - 앱스토어 숫자 ID
   * @param {string} appName
   */
  async collectAppStore(appId, appName) {
    const results = [];

    try {
      const reviews = await appStore.reviews({
        id: appId,
        sort: appStore.sort.RECENT,
        page: 1,
        country: 'kr',
      });

      const items = Array.isArray(reviews) ? reviews : [];

      for (const review of items) {
        if (review.score > COLLECT_CONFIG.apps.maxRating) continue;

        const text = review.text || '';
        const signals = extractSignals(text);

        results.push({
          source: '앱스토어',
          source_url: `https://apps.apple.com/kr/app/id${appId}`,
          original_text: `[앱] ${appName} ★${review.score}\n${text}`,
          raw_title: appName,
          raw_description: text,
          app_id: String(appId),
          app_name: appName,
          rating: review.score,
          signals,
          collected_at: new Date().toISOString(),
        });
      }

      console.log(`  앱스토어 [${appName}]: ${items.length}건 → 저점수 ${results.length}건`);
    } catch (err) {
      console.error(`❌ 앱스토어 [${appName}] 수집 실패:`, err.message);
    }

    return results;
  }

  /**
   * 설정된 모든 앱에서 리뷰 수집
   */
  async collect() {
    const targets = COLLECT_CONFIG.apps.targets;

    if (!targets || targets.length === 0) {
      console.log('⚠️  수집할 앱이 설정되지 않았습니다.');
      console.log('   src/config/index.js → COLLECT_CONFIG.apps.targets 에 앱을 추가하세요.');
      return [];
    }

    console.log(`📱 앱 리뷰 수집 시작 (${targets.length}개 앱)`);

    const allResults = [];

    for (const target of targets) {
      if (target.store === 'google') {
        const r = await this.collectGooglePlay(target.id, target.name);
        allResults.push(...r);
      } else if (target.store === 'apple') {
        const r = await this.collectAppStore(target.id, target.name);
        allResults.push(...r);
      }
      await sleep(500);
    }

    console.log(`\n✅ 앱 리뷰 수집 완료: 총 ${allResults.length}건`);
    return allResults;
  }

  /**
   * 특정 앱 단건 수집 (Telegram 커맨드용)
   * @param {string} appId - 구글 패키지명 또는 앱스토어 ID
   * @param {'google'|'apple'} store
   * @param {string} appName
   */
  async collectOne(appId, store, appName = appId) {
    if (store === 'google') return this.collectGooglePlay(appId, appName);
    if (store === 'apple') return this.collectAppStore(Number(appId), appName);
    return [];
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export default AppReviewCollector;

// 직접 실행 시 테스트
if (process.argv[1].endsWith('app-reviews.js')) {
  import('dotenv/config').then(async () => {
    const collector = new AppReviewCollector();

    // 테스트: 배달의민족 구글 플레이
    console.log('테스트: 배달의민족 리뷰 수집');
    const results = await collector.collectOne('com.baemin.android', 'google', '배달의민족');

    console.log(`\n📋 수집된 리뷰 샘플 (최대 3건):`);
    results.slice(0, 3).forEach((r, i) => {
      console.log(`\n[${i + 1}] ★${r.rating} | ${r.source}`);
      console.log(`  원문: ${r.raw_description.slice(0, 120)}...`);
      if (r.signals.length) console.log(`  신호: ${r.signals.join(', ')}`);
    });
  });
}
