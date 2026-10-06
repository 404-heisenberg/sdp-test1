import fs from 'node:fs/promises';
import path from 'node:path';
import { getReposDir } from './paths.js';
import { loadMerges } from './merges.js';
import type { Log } from './git/parseGitLog.js';
import type { PathMetrics } from './metrics/engine.js';
import { pathMetrics, fileMetrics, authorMetrics } from './metrics/engine.js';
import type { MetricsQuery, CommitSetSelection, AuthorMetrics } from './metrics/engine.js';

export interface RepoMeta {
  id: string;
  name: string;
  source: 'url' | 'zip';
  origin?: string;
  ingestedAt: string;
}

export interface RepoSummary extends RepoMeta {
  headMetrics: PathMetrics;
}

export class RepoNotFoundError extends Error {
  constructor(id: string) {
    super(`Repository not found: ${id}`);
  }
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, 'utf8')) as T;
}

/** Every ingested repository, with its root metrics for the dashboard listing. */
export async function listRepos(): Promise<RepoSummary[]> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(getReposDir());
  } catch {
    return []; // no data dir yet — nothing ingested
  }
  const summaries: RepoSummary[] = [];
  for (const id of entries) {
    if (id.startsWith('.staging-')) continue;
    const dir = path.join(getReposDir(), id);
    try {
      const meta = await readJson<RepoMeta>(path.join(dir, 'rat-meta.json'));
      const log = await readJson<Log>(path.join(dir, 'rat-log.json'));
      summaries.push({ ...meta, headMetrics: pathMetrics(log) });
    } catch {
      // Unfinished or foreign directory — skip rather than fail the whole listing.
    }
  }
  summaries.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return summaries;
}

export async function loadLog(id: string): Promise<{ meta: RepoMeta; log: Log }> {
  const dir = path.join(getReposDir(), id);
  if (id.includes('/') || id.includes('..') || id.startsWith('.staging-')) {
    throw new RepoNotFoundError(id);
  }
  try {
    const meta = await readJson<RepoMeta>(path.join(dir, 'rat-meta.json'));
    const log = await readJson<Log>(path.join(dir, 'rat-log.json'));
    return { meta, log };
  } catch {
    throw new RepoNotFoundError(id);
  }
}

/** The commit list for a repo (newest first) — feeds the manual commit picker. */
export async function listCommits(
  id: string,
): Promise<{ hash: string; authorName: string; date: string; subject: string }[]> {
  const { log } = await loadLog(id);
  return log.commits.map((c) => ({
    hash: c.hash,
    authorName: c.authorName,
    date: c.date,
    subject: c.subject,
  }));
}

export interface RepoView {
  meta: RepoMeta;
  repository: PathMetrics;
  files: PathMetrics[];
  authors: AuthorMetrics[];
}

export async function repoView(
  id: string,
  query: MetricsQuery = {},
  topFiles = 25,
): Promise<RepoView> {
  const { meta, log } = await loadLog(id);
  const merges = await loadMerges(id);
  return {
    meta,
    repository: pathMetrics(log, query),
    files: fileMetrics(log, query).slice(0, topFiles),
    authors: authorMetrics(log, query, merges),
  };
}

export async function deleteRepo(id: string): Promise<void> {
  await loadLog(id); // throws RepoNotFoundError when the id is unknown
  await fs.rm(path.join(getReposDir(), id), { recursive: true, force: true });
}

export type { MetricsQuery, CommitSetSelection };
