import { execFile, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import type { Log, LogCounts } from './parseGitLog.js';
import { createLogAccumulator } from './parseGitLog.js';

const execFileAsync = promisify(execFile);

// One full log pass: non-merge commits reachable from HEAD, rename detection at the
// 50% similarity threshold, mailmap applied to author identity, committer date in
// strict ISO, numstat rows for line counts. This is the correctness core — every
// metric is derived from what this single command reports.
//
// Mailmap: %aN/%aE resolve to the mailmapped author identity (plain %an/%ae stay
// raw on git < 2.47 even with --use-mailmap). mailmap.blob=HEAD:.mailmap applies a
// COMMITTED .mailmap on the --no-checkout clone path, which has no working tree;
// on the zip path the extracted work-tree .mailmap applies as usual. A repo without
// .mailmap treats the missing blob as empty, so the config is always safe.
const LOG_ARGS = [
  '-c',
  'mailmap.blob=HEAD:.mailmap',
  'log',
  'HEAD',
  '--no-merges',
  '-M50%',
  '--use-mailmap',
  '--numstat',
  '--format=%H%x1f%aN%x1f%aE%x1f%cI%x1f%s',
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
 * git writes progress to stderr; onPercent picks the receive percentage out of it.
 */
export async function gitClone(
  url: string,
  dest: string,
  onPercent?: (percent: number) => void,
): Promise<void> {
  try {
    await cloneChild(url, dest, onPercent);
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const detail = (e.stderr ?? e.message ?? '').toString().trim();
    throw new GitError(detail || `failed to clone ${url}`);
  }
}

function cloneChild(url: string, dest: string, onPercent?: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'git',
      ['clone', '--progress', '--no-checkout', url, dest],
      { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    );
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      const m = chunk.match(/(Receiving objects|Resolving deltas|Updating files):\s+\d+% \((\d+)%/);
      if (m) onPercent?.(Number(m[2]));
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new GitError(stderr.trim() || `failed to clone ${url}`));
    });
    child.on('error', (err) => reject(new GitError(err.message)));
  });
}

/**
 * Parse the output of LOG_ARGS into the flat row store: one entry per commit and
 * one row per (commit, non-binary file change). Rename rows resolve to the NEW path.
 */
export function parseGitLogOutput(text: string): Log {
  const acc = createLogAccumulator();
  acc.push(text);
  return acc.result();
}

/** Progress callback for the streamed log pass: running commit/row counts. */
export type LogProgress = (counts: LogCounts) => void;

/**
 * Run the single git log pass and parse it incrementally as lines stream in.
 * Keeps memory bounded to the row store itself, reports progress while git is
 * still running, and — because parsing interleaves with stdout chunks — leaves
 * the event loop free to serve other requests during large-repo ingestion.
 */
export function gitLogStream(repoPath: string, onProgress?: LogProgress): Promise<Log> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', LOG_ARGS, { cwd: repoPath });
    const acc = createLogAccumulator();
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line: string) => {
      acc.push(`${line}\n`);
      onProgress?.(acc.counts());
    });
    rl.on('close', () => {
      acc.end();
      if (child.exitCode === 0) {
        resolve(acc.result());
      } else {
        reject(new GitError(stderr.trim() || `git log exited with code ${child.exitCode}`));
      }
    });
    child.on('error', (err) => {
      reject(new GitError(err.message));
    });
  });
}

/** Run the single git log pass over a repository working tree and build the row store. */
export async function gitLog(repoPath: string, onProgress?: LogProgress): Promise<Log> {
  return gitLogStream(repoPath, onProgress);
}
