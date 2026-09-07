/**
 * naver-kin.js
 * 네이버 검색 API로 지식iN / 블로그 / 뉴스에서 불평 시그널을 수집한다
 *
 * 네이버 검색 API 문서: https://developers.naver.com/docs/serviceapi/search/
 * 무료 일일 25,000 호출
 */

import axios from 'axios';
import { COMPLAINT_SIGNALS, COLLECT_CONFIG } from '../config/index.js';

const BASE_URL = 'https://openapi.naver.com/v1/search';

// 불평 시그널 문장이 포함되었는지 확인
function hasComplaintSignal(text) {
  if (!text) return false;
  return COMPLAINT_SIGNALS.some((signal) => text.includes(signal));
}

// HTML 태그와 엔티티 제거
function stripHtml(text) {
  if (!text) return '';
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '')
    .trim();
}

// 발견된 불평 시그널 목록 추출
function extractSignals(text) {
  return COMPLAINT_SIGNALS.filter((s) => text.includes(s));
}

class NaverCollector {
  constructor() {
    this.clientId = process.env.NAVER_CLIENT_ID;
    this.clientSecret = process.env.NAVER_CLIENT_SECRET;

    if (!this.clientId || !this.clientSecret) {
      throw new Error(
        'NAVER_CLIENT_ID 또는 NAVER_CLIENT_SECRET이 .env에 없습니다.\n' +
        '발급: https://developers.naver.com/apps'
      );
    }
  }

  get headers() {
    return {
      'X-Naver-Client-Id': this.clientId,
      'X-Naver-Client-Secret': this.clientSecret,
    };
  }

  /**
   * 네이버 API 검색
   * @param {'kin'|'blog'|'news'} type
   * @param {string} query
   * @param {number} display
   */
  async search(type, query, display = 10) {
    try {
      const { data } = await axios.get(`${BASE_URL}/${type}`, {
        headers: this.headers,
        params: {
          query,
          display,
          sort: 'date', // 최신순
        },
      });
      return data.items || [];
    } catch (err) {
      if (err.response?.status === 429) {
        console.warn(`⚠️  API 한도 초과 (잠시 대기 후 재시도)`);
        await sleep(5000);
        return [];
      }
      console.error(`❌ 네이버 API 오류 [${type}] "${query}":`, err.message);
      return [];
    }
  }

  /**
   * 지식iN 검색 결과를 ProblemCandidate 형태로 변환
   */
  parseKinItems(items, query) {
    const results = [];

    for (const item of items) {
      const title = stripHtml(item.title);
      const description = stripHtml(item.description);
      const fullText = `${title} ${description}`;

      if (!hasComplaintSignal(fullText)) continue;

      results.push({
        source: '네이버 지식iN',
        source_url: item.link,
        original_text: `[질문] ${title}\n[내용] ${description}`,
        raw_title: title,
        raw_description: description,
        query,
        signals: extractSignals(fullText),
        collected_at: new Date().toISOString(),
      });
    }

    return results;
  }

  /**
   * 블로그 검색 결과를 ProblemCandidate 형태로 변환
   */
  parseBlogItems(items, query) {
    const results = [];

    for (const item of items) {
      const title = stripHtml(item.title);
      const description = stripHtml(item.description);
      const fullText = `${title} ${description}`;

      if (!hasComplaintSignal(fullText)) continue;

      results.push({
        source: '네이버 블로그',
        source_url: item.link,
        original_text: `[제목] ${title}\n[내용] ${description}`,
        raw_title: title,
        raw_description: description,
        query,
        signals: extractSignals(fullText),
        collected_at: new Date().toISOString(),
      });
    }

    return results;
  }

  /**
   * 모든 검색 쿼리로 수집 실행
   * @returns {Promise<Array>} 불평 시그널이 있는 항목 목록
   */
  async collect() {
    const { searchQueries, displayCount } = COLLECT_CONFIG.naver;
    const allResults = [];

    console.log(`🔍 네이버 수집 시작 (${searchQueries.length}개 쿼리)`);

    for (const query of searchQueries) {
      // 지식iN
      const kinItems = await this.search('kin', query, displayCount);
      const kinResults = this.parseKinItems(kinItems, query);
      allResults.push(...kinResults);
      console.log(`  지식iN "${query}": ${kinItems.length}건 수집, ${kinResults.length}건 신호`);

      // 블로그
      const blogItems = await this.search('blog', query, displayCount);
      const blogResults = this.parseBlogItems(blogItems, query);
      allResults.push(...blogResults);
      console.log(`  블로그 "${query}": ${blogItems.length}건 수집, ${blogResults.length}건 신호`);

      // API 호출 간격 (과부하 방지)
      await sleep(300);
    }

    // 중복 제거 (URL 기준)
    const unique = deduplicateByUrl(allResults);
    console.log(`\n✅ 네이버 수집 완료: ${allResults.length}건 → 중복 제거 후 ${unique.length}건`);

    return unique;
  }

  /**
   * 커스텀 키워드로 단건 검색 (Telegram /collect 커맨드용)
   * @param {string} keyword
   * @param {'kin'|'blog'|'news'} type
   */
  async searchByKeyword(keyword, type = 'kin') {
    const items = await this.search(type, keyword, 10);

    if (type === 'kin') return this.parseKinItems(items, keyword);
    if (type === 'blog') return this.parseBlogItems(items, keyword);
    return [];
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function deduplicateByUrl(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.source_url)) return false;
    seen.add(item.source_url);
    return true;
  });
}

export default NaverCollector;

// 직접 실행 시 테스트
if (process.argv[1].endsWith('naver-kin.js')) {
  import('dotenv/config').then(async () => {
    try {
      const collector = new NaverCollector();
      const results = await collector.collect();
      console.log('\n📋 샘플 결과:');
      results.slice(0, 3).forEach((r, i) => {
        console.log(`\n[${i + 1}] ${r.source}`);
        console.log(`  URL: ${r.source_url}`);
        console.log(`  신호: ${r.signals.join(', ')}`);
        console.log(`  원문: ${r.original_text.slice(0, 100)}...`);
      });
    } catch (err) {
      console.error(err.message);
    }
  });
}
