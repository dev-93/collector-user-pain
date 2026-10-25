import 'dotenv/config';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AIAnalyzer from '../src/services/ai-analyzer.js';
import { BatchStore } from '../src/services/batch-store.js';
import { runDailyBatch } from '../src/services/daily-batch.js';
import { sendTelegramReport } from '../src/services/report-sender.js';

// 실제 고객 사례나 수집 실적으로 사용하지 않는 연결 점검용 가상 입력.
const candidate = {
  source: 'synthetic-smoke-test', evidence_state: 'self_report',
  original_text: '[가상 테스트 자료: 실제 고객 발언이 아님] 나는 원격으로 숙소 3개를 관리하는 운영자다. 매주 청소 담당자의 일정 변경으로 대체 인력을 찾고 사진으로 청소 상태를 확인하는 데 3시간을 쓴다. 지난달 확인이 늦어 재청소 비용 8만원을 내가 부담했다. 현재 청소마다 외주 업체에 비용을 지불하고 일정과 사진은 메신저로 관리한다.',
};

try {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) throw new Error('telegram_config_missing');
  if (process.argv.includes('--diagnose')) {
    for (const method of ['getMe', 'getChat']) {
      try {
        const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
          method: 'POST', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(method === 'getChat' ? { chat_id: process.env.TELEGRAM_CHAT_ID } : {}),
        });
        const body = await response.json();
        console.log(JSON.stringify({ method, status: response.status, ok: body.ok, error_code: body.error_code }));
      } catch { console.log(JSON.stringify({ method, status: 'network_failed' })); }
    }
    process.exit(0);
  }
  if (!['OPENROUTER_API_KEY', 'GROQ_API_KEY', 'GEMINI_API_KEY'].some((key) => process.env[key])) throw new Error('ai_config_missing');
  const directory = await mkdtemp(join(tmpdir(), 'problem-radar-smoke-'));
  const report = await runDailyBatch({ store: new BatchStore(directory),
    collect: async () => ({ candidates: [candidate], sources: [{ id: 'synthetic-smoke-test', status: 'ok', count: 1 }] }),
    analyzerFactory: async () => new AIAnalyzer(),
    sendReport: (text) => sendTelegramReport(`🧪 연결 테스트 · 가상 사례 1건\n실제 수집 결과가 아닙니다. Notion 저장 없음.\n\n${text}`, {
      token: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID }),
  });
  console.log(JSON.stringify({ status: report.status, counts: report.counts, ai_usage: report.ai_usage, telegram: 'sent', notion_written: false }));
} catch {
  console.error('연결 테스트 실패. 비밀값 보호를 위해 원본 오류는 출력하지 않습니다. 발송 여부를 확인한 뒤 재실행하세요.');
  process.exitCode = 1;
}
