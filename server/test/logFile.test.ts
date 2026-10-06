import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeLogFile, readLogFile } from '../src/logFile.js';
import { parseGitLogOutput } from '../src/git/runner.js';

const SAMPLE = [
  'hash1\x1fAlice\x1falice@example.com\x1f2026-01-01T00:00:00+00:00\x1ffirst',
  '10\t2\tsrc/main.ts',
  '-\t-\tbin/logo.png',
  '',
  'hash2\x1fBob\x1fbob@example.com\x1f2026-01-02T00:00:00+00:00\x1frename',
  '0\t0\tsrc/{a.ts => b.ts}',
  '3\t1\tsrc/deep/{x/y.ts => z/y.ts}',
  '',
].join('\n');

describe('writeLogFile / readLogFile', () => {
  let dir: string | null = null;

  afterEach(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it('round-trips a log through chunked JSON', async () => {
    dir = await fs.mkdtemp(path.join(process.cwd(), '.tmp-logfile-'));
    const log = parseGitLogOutput(SAMPLE);
    const file = path.join(dir, 'rat-log.json');
    await writeLogFile(file, log);
    expect(await readLogFile(file)).toEqual(log);
  });

  it('writes valid JSON for an empty store', async () => {
    dir = await fs.mkdtemp(path.join(process.cwd(), '.tmp-logfile-'));
    const file = path.join(dir, 'rat-log.json');
    await writeLogFile(file, { commits: [], rows: [] });
    expect(await readLogFile(file)).toEqual({ commits: [], rows: [] });
  });
});
