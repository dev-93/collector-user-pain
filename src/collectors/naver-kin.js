/**
 * naver-kin.js
 * 네이버 검색 API로 지식iN / 블로그 / 뉴스에서 불평 시그널을 수집한다
 *
 * 네이버 검색 API 문서: https://developers.naver.com/docs/serviceapi/search/
 * 무료 일일 25,000 호출
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { COMPLAINT_SIGNALS, COLLECT_CONFIG } from '../config/index.js';

// 2026년 6월 이후 NAVER API HUB로 이관됨
// 구 endpoint: https://openapi.naver.com/v1/search/{type}
// 신 endpoint: https://naverapihub.apigw.ntruss.com/search/v1/{type}
const BASE_URL = 'https://naverapihub.apigw.ntruss.com/search/v1';

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
  }

  get headers() {
    if (!this.clientId) return {};
    return {
      'X-NCP-APIGW-API-KEY-ID': this.clientId,
      'X-NCP-APIGW-API-KEY': this.clientSecret,
    };
  }

  /**
   * NAVER API HUB 검색
   */
  async search(type, query, display = 10) {
    if (!this.clientId) return [];
    try {
      const { data } = await axios.get(`${BASE_URL}/${type}`, {
        headers: this.headers,
        params: { query, display, sort: 'date' },
      });
      return data.items || [];
    } catch (err) {
      if (err.response?.status === 429) {
        console.warn(`⚠️  Naver API 한도 초과 (잠시 대기 후 재시도)`);
        await sleep(5000);
      }
      return [];
    }
  }

  /**
   * Google News RSS 수집기 (Naver API 대체/보완용 - API 키 불필요)
   */
  async searchGoogleNews(query) {
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
      const res = await axios.get(url, { timeout: 5000 });
      const $ = cheerio.load(res.data, { xmlMode: true });
      const results = [];

      // 쿼리 자체에서 신호 추출 (본문 없는 뉴스 제목 보정용)
      const querySignals = COMPLAINT_SIGNALS.filter((s) => query.includes(s));

      $('item').each((i, el) => {
        const title = stripHtml($(el).find('title').text());
        const link = $(el).find('link').text();
        const pubDate = $(el).find('pubDate').text();
        const fullText = title;

        const textSignals = extractSignals(fullText);
        const allSignals = [...new Set([...textSignals, ...querySignals])];

        results.push({
          source: '구글 뉴스 (웹 수집)',
          source_url: link,
          original_text: `[기사/뉴스] ${title}`,
          raw_title: title,
          raw_description: title,
          query,
          signals: allSignals,
          collected_at: new Date(pubDate || Date.now()).toISOString(),
        });
      });

      return results;
    } catch (err) {
      console.warn(`⚠️ 구글 뉴스 수집 오류 "${query}":`, err.message);
      return [];
    }
  }

  parseKinItems(items, query) {
    const results = [];

    for (const item of items) {
      const title = stripHtml(item.title);
      const description = stripHtml(item.description);
      const fullText = `${title} ${description}`;

      // 신호가 없어도 검색 쿼리 자체가 불평 키워드이므로 일단 수집
      // pre-filter 단계에서 품질 판단
      const signals = extractSignals(fullText);
      // 쿼리 키워드도 신호로 추가 (중복 제거)
      const querySignals = COMPLAINT_SIGNALS.filter((s) => query.includes(s));
      const allSignals = [...new Set([...signals, ...querySignals])];

      results.push({
        source: '네이버 지식iN',
        source_url: item.link,
        original_text: `[질문] ${title}\n[내용] ${description}`,
        raw_title: title,
        raw_description: description,
        query,
        signals: allSignals,
        collected_at: new Date().toISOString(),
      });
    }

    return results;
  }

  parseBlogItems(items, query) {
    const results = [];

    for (const item of items) {
      const title = stripHtml(item.title);
      const description = stripHtml(item.description);
      const fullText = `${title} ${description}`;

      const signals = extractSignals(fullText);
      const querySignals = COMPLAINT_SIGNALS.filter((s) => query.includes(s));
      const allSignals = [...new Set([...signals, ...querySignals])];

      results.push({
        source: '네이버 블로그',
        source_url: item.link,
        original_text: `[제목] ${title}\n[내용] ${description}`,
        raw_title: title,
        raw_description: description,
        query,
        signals: allSignals,
        collected_at: new Date().toISOString(),
      });
    }

    return results;
  }

  async collect() {
    const { searchQueries, displayCount, sources = {} } = COLLECT_CONFIG.naver;
    const allResults = [];

    console.log(`🔍 사용자 질문 원문 수집 시작 (${searchQueries.length}개 쿼리)`);

    for (const query of searchQueries) {
      const kinResults = sources.kin === false
        ? []
        : this.parseKinItems(await this.search('kin', query, displayCount), query);
      allResults.push(...kinResults);

      const blogResults = sources.blog
        ? this.parseBlogItems(await this.search('blog', query, displayCount), query)
        : [];
      allResults.push(...blogResults);

      const googleResults = sources.googleNews
        ? await this.searchGoogleNews(query)
        : [];
      allResults.push(...googleResults);

      console.log(`  쿼리 "${query}": 네이버 ${kinResults.length + blogResults.length}건, 구글 ${googleResults.length}건 수집`);
      await sleep(300);
    }

    const unique = deduplicateByUrl(allResults);
    console.log(`\n✅ 웹/웹문서 수집 완료: ${allResults.length}건 → 중복 제거 후 ${unique.length}건`);

    return unique;
  }

  async searchByKeyword(keyword, type = 'kin') {
    const items = await this.search(type, keyword, 10);
    if (type === 'kin') return this.parseKinItems(items, keyword);
    if (type === 'blog') return this.parseBlogItems(items, keyword);
    return this.searchGoogleNews(keyword);
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
