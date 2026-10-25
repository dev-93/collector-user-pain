import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadSourceConfig, collectSources } from '../src/services/source-loader.js';
import { BatchStore } from '../src/services/batch-store.js';
import { runDailyBatch, buildDailyMessage } from '../src/services/daily-batch.js';
import { sendTelegramReport } from '../src/services/report-sender.js';

const { values } = parseArgs({ options: { live: { type: 'boolean', default: false },
  check: { type: 'boolean', default: false }, input: { type: 'string' }, help: { type: 'boolean' } } });
if (values.help) {
  console.log('npm run daily -- [--check | --input <JSON 파일> | --live]');
  console.log('기본은 로컬 자료 점검. --live만 허용 출처·AI·Notion 읽기를 실행. 보고는 RADAR_SEND_REPORT=true로 별도 활성화. Notion 쓰기 없음.');
  process.exit(0);
}

try {
  if (values.input && values.live) throw new Error('live_input_conflict');
  const path = process.env.RADAR_SOURCES_FILE || 'config/sources.json';
  const sources = await loadSourceConfig(path);
  const stateDirectory = process.env.RADAR_STATE_DIR || 'data/batch';
  const sendEnabled = process.env.RADAR_SEND_REPORT === 'true';
  const aiConfigured = ['OPENROUTER_API_KEY', 'GROQ_API_KEY', 'GEMINI_API_KEY'].some((key) => process.env[key]);
  const missing = [];
  if (!sources.length) missing.push('approved_sources');
  if (!aiConfigured) missing.push('ai_credentials');
  if (!process.env.NOTION_TOKEN || !process.env.NOTION_PROBLEM_DB_ID) missing.push('notion_credentials');
  if (sendEnabled && (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID)) missing.push('telegram_credentials');
  if (process.env.RAILWAY_ENVIRONMENT_ID && (!process.env.RAILWAY_VOLUME_MOUNT_PATH
    || !resolve(stateDirectory).startsWith(`${resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH)}/`))) missing.push('persistent_volume');
  if (values.check) {
    console.log(JSON.stringify({ ready: !missing.length, sources: sources.map((s) => s.id), report_enabled: sendEnabled, missing }));
    process.exitCode = missing.length ? 2 : 0;
  } else {
    if (values.live && missing.length) {
      console.log(JSON.stringify({ status: 'blocked', missing }));
      process.exitCode = 2;
    } else {
      let existing = [];
      let analyzerFactory = async () => null;
      if (values.live) {
        const { default: NotionService } = await import('../src/services/notion-service.js');
        // 실패하면 배치 시작 전 중단한다. 읽기 실패를 기존 항목 없음으로 취급하지 않는다.
        existing = await new NotionService().getAllProblems();
        analyzerFactory = async () => { const { default: AIAnalyzer } = await import('../src/services/ai-analyzer.js'); return new AIAnalyzer(); };
      }
      const input = values.input ? JSON.parse(await readFile(values.input, 'utf8')) : [];
      if (!Array.isArray(input)) throw new Error('input_not_array');
      const report = await runDailyBatch({ store: new BatchStore(values.live ? stateDirectory : 'data/batch-preview'),
        collect: values.live ? () => collectSources(sources) : async () => ({ candidates: input,
          sources: values.input ? [{ id: 'local-fixture', status: 'ok', count: input.length }] : [] }),
        analyzerFactory, existing,
        sendReport: values.live && sendEnabled ? (text) => sendTelegramReport(text, {
          token: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID }) : null });
      console.log(buildDailyMessage(report));
      console.log(JSON.stringify({ status: report.status, replayed: !!report.replayed, ai_usage: report.ai_usage }));
      if (report.status !== 'ok') process.exitCode = 2;
    }
  }
} catch (error) {
  // SDK 오류에는 요청 URL이나 자격 증명이 섞일 수 있어 알려진 코드만 출력한다.
  const code = /^[a-z_]{1,60}$/.test(error.message) ? error.message : 'daily_batch_failed';
  console.error(JSON.stringify({ status: 'failed', code }));
  process.exitCode = 1;
}
