import fs from 'node:fs/promises';
import path from 'node:path';
import extract from 'extract-zip';
import { gitClone, gitLog } from './git/runner.js';
import { getReposDir } from './paths.js';
import type { Log } from './git/parseGitLog.js';

export class IngestError extends Error {}

export interface Ingested {
  id: string;
  name: string;
  source: 'url' | 'zip';
  origin?: string;
}

/** A slug for the data directory: readable + unique enough for repeated names. */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/\.git$/, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const stem = base || 'repo';
  return `${stem}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Repo name from a git URL: trailing path segment with .git stripped. */
export function nameFromUrl(url: string): string {
  const clean = url.replace(/\/+$/, '');
  const seg = clean.slice(clean.lastIndexOf('/') + 1) || clean;
  return seg.replace(/\.git$/, '') || clean;
}

/**
 * Find the repository root inside an extracted zip: a directory containing .git,
 * checked at the extraction root and one level deep (for zips that wrap the repo
 * in a single folder). Returns null when no .git is present anywhere allowed.
 */
export function findGitRoot(extractRoot: string, entries: string[]): string | null {
  const top = (rel: string) => rel.split('/')[0];
  if (entries.some((e) => e === '.git' || e.startsWith('.git/'))) return extractRoot;
  const oneLevel = [...new Set(entries.filter((e) => e.includes('/')).map(top))];
  for (const dir of oneLevel) {
    if (entries.some((e) => e === `${dir}/.git` || e.startsWith(`${dir}/.git/`))) {
      return path.join(extractRoot, dir);
    }
  }
  return null;
}

async function ingestInto(
  name: string,
  source: 'url' | 'zip',
  workTree: string,
  origin?: string,
): Promise<Ingested> {
  const log: Log = await gitLog(workTree);
  const id = slugify(name);
  const dest = path.join(getReposDir(), id);
  await fs.mkdir(getReposDir(), { recursive: true });
  await fs.rename(workTree, dest);
  await fs.writeFile(
    path.join(dest, 'rat-meta.json'),
    JSON.stringify({ id, name, source, origin, ingestedAt: new Date().toISOString() }, null, 2),
  );
  await fs.writeFile(path.join(dest, 'rat-log.json'), JSON.stringify(log));
  return { id, name, source, origin };
}

/** Ingest from a remote URL: deep clone, then run the single log pass. */
export async function ingestUrl(rawUrl: string): Promise<Ingested> {
  const url = rawUrl.trim();
  if (!/^(https?|git|ssh|file):\/\/|^git@/.test(url)) {
    throw new IngestError(`Invalid git URL: ${rawUrl}`);
  }
  await fs.mkdir(getReposDir(), { recursive: true });
  const staging = await fs.mkdtemp(path.join(getReposDir(), '.staging-'));
  try {
    await gitClone(url, staging);
    return await ingestInto(nameFromUrl(url), 'url', staging, url);
  } catch (err) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    if (err instanceof IngestError) throw err;
    const e = err as Error;
    throw new IngestError(`Failed to clone ${url}: ${e.message}`);
  }
}

/** Ingest from an uploaded zip: extract, find .git (one level deep), log pass. */
export async function ingestZip(zipPath: string, fallbackName?: string): Promise<Ingested> {
  await fs.mkdir(getReposDir(), { recursive: true });
  const staging = await fs.mkdtemp(path.join(getReposDir(), '.staging-'));
  try {
    await extract(zipPath, { dir: staging });
    const entries: string[] = [];
    const walk = async (dir: string) => {
      for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
        const rel = path.relative(staging, path.join(dir, ent.name));
        entries.push(rel);
        if (ent.isDirectory()) await walk(path.join(dir, ent.name));
      }
    };
    await walk(staging);
    const gitRoot = findGitRoot(staging, entries);
    if (!gitRoot) {
      throw new IngestError(
        'Zip does not contain a .git directory (searched the top level and one level deep).',
      );
    }
    const name =
      fallbackName ??
      path.basename(gitRoot !== staging ? gitRoot : zipPath).replace(/\.zip$/i, '') ??
      'zip-repo';
    const ingested = await ingestInto(name, 'zip', gitRoot, undefined);
    // The worktree moved into the registry; drop any zip leftovers around it.
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    return ingested;
  } catch (err) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    if (err instanceof IngestError) throw err;
    throw new IngestError(`Failed to ingest zip: ${(err as Error).message}`);
  }
}
