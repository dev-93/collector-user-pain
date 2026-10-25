import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { runCollection } from '../src/services/collection-pipeline.js';
const args = process.argv.slice(2);
const input = args.includes('--input') ? args[args.indexOf('--input') + 1] : 'tests/fixtures/collection.json';
const items = JSON.parse(await readFile(input, 'utf8'));
// 비교 기준은 변경 전 커밋으로 고정한다. API와 현재 .env를 읽지 않는다.
const baseline = execFileSync('git', ['show', '86d3386:src/utils/pre-filter.js'], { encoding: 'utf8' })
  .replace("'../config/index.js'", JSON.stringify(pathToFileURL(`${process.cwd()}/src/config/index.js`).href));
const { preFilter } = await import(`data:text/javascript;base64,${Buffer.from(baseline).toString('base64')}`);
const before = preFilter(items, { minPreScore: 40, maxCount: 10, verbose: false });
const after = await runCollection(items);
console.log(JSON.stringify({ sample: input, baseline_commit: '86d3386', input: items.length,
  before: { prefilter_pass: before.length, discarded_before_ai: items.length - before.length },
  after: { ...after.counts, reasons: after.reason_counts },
  caveat: '규칙과 보존 비교이며 AI·운영 수집 성공률 또는 사업성 비교가 아닙니다.' }, null, 2));
