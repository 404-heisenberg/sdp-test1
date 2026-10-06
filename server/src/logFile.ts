import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import type { Log } from './git/parseGitLog.js';

// Entries per write chunk: batches keep stream overhead low while ensuring no
// single JSON.stringify call (or single blocking write) spans the whole store.
const BATCH = 500;

/** Serialize the row store to disk in chunks — huge repos never block the event loop with one giant stringify. */
export async function writeLogFile(file: string, log: Log): Promise<void> {
  const ws = createWriteStream(file);
  const write = async (s: string): Promise<void> => {
    if (!ws.write(s)) {
      await new Promise<void>((resolve) => ws.once('drain', resolve));
    }
  };
  await write('{"commits":[');
  for (let i = 0; i < log.commits.length; i += BATCH) {
    if (i > 0) await write(',');
    await write(
      log.commits
        .slice(i, i + BATCH)
        .map((c) => JSON.stringify(c))
        .join(','),
    );
  }
  await write('],"rows":[');
  for (let i = 0; i < log.rows.length; i += BATCH) {
    if (i > 0) await write(',');
    await write(
      log.rows
        .slice(i, i + BATCH)
        .map((r) => JSON.stringify(r))
        .join(','),
    );
  }
  await write(']}');
  await new Promise<void>((resolve, reject) => {
    ws.end(() => resolve());
    ws.on('error', reject);
  });
}

export async function readLogFile(file: string): Promise<Log> {
  return JSON.parse(await fs.readFile(file, 'utf8')) as Log;
}
