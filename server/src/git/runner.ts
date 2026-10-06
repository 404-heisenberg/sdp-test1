import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Log } from './parseGitLog.js';
import { parseNumstatLine } from './parseGitLog.js';

const execFileAsync = promisify(execFile);

// One full log pass: non-merge commits reachable from HEAD, rename detection at the
// 50% similarity threshold, mailmap applied to author identity, committer date in
// strict ISO, numstat rows for line counts. This is the correctness core — every
// metric is derived from what this single command reports.
const LOG_ARGS = [
  'log',
  'HEAD',
  '--no-merges',
  '-M50%',
  '--use-mailmap',
  '--numstat',
  '--format=%H%x1f%an%x1f%ae%x1f%cI%x1f%s',
];

export class GitError extends Error {}

export async function runGit(
  cwd: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      env: { ...process.env, ...opts.env },
      // Large repositories produce very large log output; the streaming perf pass
      // comes later, so allow a generous buffer for now.
      maxBuffer: 2 * 1024 * 1024 * 1024 - 1,
    });
    return stdout;
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const detail = (e.stderr ?? e.message ?? '').toString().trim();
    throw new GitError(detail || `git ${args[0]} failed`);
  }
}

/**
 * Deep-clone a remote URL (no shallow, no single-branch) so every commit reachable
 * from the remote HEAD exists locally. GIT_TERMINAL_PROMPT=0 makes a nonexistent or
 * private repository fail fast instead of hanging on a hidden credential prompt.
 */
export async function gitClone(url: string, dest: string): Promise<void> {
  try {
    await execFileAsync(
      'git',
      ['clone', '--no-checkout', url, dest],
      {
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        maxBuffer: 2 * 1024 * 1024 * 1024 - 1,
      },
    );
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const detail = (e.stderr ?? e.message ?? '').toString().trim();
    throw new GitError(detail || `failed to clone ${url}`);
  }
}

/**
 * Parse the output of LOG_ARGS into the flat row store: one entry per commit and
 * one row per (commit, non-binary file change). Rename rows resolve to the NEW path.
 */
export function parseGitLogOutput(text: string): Log {
  const commits: Log['commits'] = [];
  const rows: Log['rows'] = [];
  let currentHash: string | null = null;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line === '') continue;
    if (line.includes('\x1f')) {
      const parts = line.split('\x1f');
      if (parts.length >= 5) {
        currentHash = parts[0];
        commits.push({
          hash: parts[0],
          authorName: parts[1],
          authorEmail: parts[2],
          date: parts[3],
          subject: parts[4],
        });
        continue;
      }
    }
    const row = parseNumstatLine(line);
    if (row && currentHash !== null) {
      rows.push({ hash: currentHash, ...row });
    }
  }
  return { commits, rows };
}

/** Run the single git log pass over a repository working tree and build the row store. */
export async function gitLog(repoPath: string): Promise<Log> {
  const out = await runGit(repoPath, LOG_ARGS);
  return parseGitLogOutput(out);
}
