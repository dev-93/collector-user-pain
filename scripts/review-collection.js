import { readFile, writeFile } from 'node:fs/promises';
import { runCollection } from '../src/services/collection-pipeline.js';

const args = process.argv.slice(2);
const value = (name) => args[args.indexOf(name) + 1];
const allowed = new Set(['--input', '--existing', '--output', '--analyze', '--notion-read', '--help']);
if (args.some((arg) => arg.startsWith('--') && !allowed.has(arg))) throw new Error('지원하지 않는 옵션입니다. --help를 확인하세요.');
if (args.includes('--help') || !args.includes('--input')) {
  console.log('npm run review -- --input <원문 JSON 배열> [--existing <기존 후보 JSON 배열>] [--output <로컬 보고서>] [--analyze] [--notion-read]');
  console.log('기본: 외부 호출/Notion 쓰기 없음. --analyze는 허용 원문만 최대 5건 AI 전송. --notion-read는 기존 DB 읽기만 수행.');
  process.exit(0);
}
for (const name of ['--input', '--existing', '--output']) {
  if (args.includes(name) && (!value(name) || value(name).startsWith('--'))) throw new Error(`${name} 경로가 필요합니다.`);
}
if (args.includes('--analyze') || args.includes('--notion-read')) await import('dotenv/config');
const candidates = JSON.parse(await readFile(value('--input'), 'utf8'));
let existing = args.includes('--existing') ? JSON.parse(await readFile(value('--existing'), 'utf8')) : [];
if (!Array.isArray(existing)) throw new Error('기존 후보는 JSON 배열이어야 합니다.');
if (args.includes('--notion-read')) {
  const { default: NotionService } = await import('../src/services/notion-service.js');
  existing = [...existing, ...await new NotionService().getAllProblems()];
}
let analyzer;
if (args.includes('--analyze')) {
  const { default: AIAnalyzer } = await import('../src/services/ai-analyzer.js');
  analyzer = new AIAnalyzer();
}
const report = await runCollection(candidates, { analyzer, existing });
if (args.includes('--output')) {
  // 원문을 담은 보고서는 사용자가 지정한 로컬 경로에만 저장한다.
  await writeFile(value('--output'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
}
console.log(JSON.stringify({ mode: report.mode, counts: report.counts, reasons: report.reason_counts,
  decisions: report.records.map((r) => ({ index: r.index, disposition: r.disposition, plan: r.plan })) }, null, 2));
