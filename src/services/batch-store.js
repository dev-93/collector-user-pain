import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// 단일 Railway 서비스 + 동일 영속 볼륨 기준. 다른 볼륨/여러 지역 간 분산 잠금은 아니다.
export class BatchStore {
  constructor(directory) { this.directory = directory; this.lock = join(directory, 'batch.lock'); }
  async acquire() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try { await mkdir(this.lock, { mode: 0o700 }); }
    catch (error) { if (error.code === 'EEXIST') throw new Error('batch_locked'); throw error; }
  }
  async release() { await rm(this.lock, { recursive: true, force: true }); }
  async load() {
    try { return JSON.parse(await readFile(join(this.directory, 'state.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return { version: 1, runs: {}, items: {} }; throw new Error('state_read_failed'); }
  }
  async save(state) {
    const temp = join(this.directory, `.state-${randomUUID()}.json`);
    await writeFile(temp, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
    await rename(temp, join(this.directory, 'state.json'));
  }
}
