import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** The repository root (the workspace containing server/ and client/). */
export const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** Server-side data directory (ingested repos, row stores, uploads). Override with RAT_DATA_DIR. */
export function getDataDir(): string {
  return process.env.RAT_DATA_DIR
    ? path.resolve(process.env.RAT_DATA_DIR)
    : path.join(repoRoot, 'data');
}

export function getReposDir(): string {
  return path.join(getDataDir(), 'repos');
}
