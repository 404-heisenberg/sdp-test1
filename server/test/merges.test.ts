import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadMerges, saveMerge, deleteMerge, MergeError } from '../src/merges.js';
import { RepoNotFoundError } from '../src/registry.js';
import { authorMetrics } from '../src/metrics/engine.js';
import type { Log } from '../src/git/parseGitLog.js';

// Minimal stored repo: two files of hand-computed rows across three identities
// (alice@x, ally@x — the alias to merge into alice — and bob@x).
const storedLog: Log = {
  commits: [
    { hash: 'c3', authorName: 'Alice A.', authorEmail: 'ally@x', date: '2024-01-03T10:00:00Z', subject: 'c3' },
    { hash: 'c2', authorName: 'Bob', authorEmail: 'bob@x', date: '2024-01-02T10:00:00Z', subject: 'c2' },
    { hash: 'c1', authorName: 'Alice', authorEmail: 'alice@x', date: '2024-01-01T10:00:00Z', subject: 'c1' },
  ],
  rows: [
    { hash: 'c1', path: 'src/a.ts', added: 10, removed: 0 },
    { hash: 'c2', path: 'src/a.ts', added: 3, removed: 2 },
    { hash: 'c2', path: 'docs/r.md', added: 5, removed: 0 },
    { hash: 'c3', path: 'src/b.ts', added: 1, removed: 1 },
  ],
};

let dataDir: string;
const REPO = 'repo-under-test';

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rat-merges-'));
  process.env.RAT_DATA_DIR = dataDir;
  const dir = path.join(dataDir, 'repos', REPO);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'rat-meta.json'),
    JSON.stringify({ id: REPO, name: REPO, source: 'url', ingestedAt: '2024-01-01T00:00:00Z' }),
  );
  await fs.writeFile(path.join(dir, 'rat-log.json'), JSON.stringify(storedLog));
});

afterEach(async () => {
  delete process.env.RAT_DATA_DIR;
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe('author merge persistence', () => {
  it('starts with no merges when none were saved', async () => {
    expect(await loadMerges(REPO)).toEqual([]);
  });

  it('saves a merge (canonical + alias) and loads it back', async () => {
    const merges = await saveMerge(REPO, 'alice@x', ['ally@x']);
    expect(merges).toEqual([{ canonicalEmail: 'alice@x', aliases: ['ally@x'] }]);
    expect(await loadMerges(REPO)).toEqual(merges);
  });

  it('appends to the existing entry when the canonical merges again', async () => {
    await saveMerge(REPO, 'alice@x', ['ally@x']);
    const merges = await saveMerge(REPO, 'alice@x', ['bob@x', 'ally@x']);
    expect(merges).toEqual([{ canonicalEmail: 'alice@x', aliases: ['ally@x', 'bob@x'] }]);
  });

  it('undoes a merge, restoring prior identities', async () => {
    await saveMerge(REPO, 'alice@x', ['ally@x']);
    const merges = await deleteMerge(REPO, 'alice@x');
    expect(merges).toEqual([]);
    expect(await loadMerges(REPO)).toEqual([]);
  });

  it('rejects an unknown canonical or alias email', async () => {
    await expect(saveMerge(REPO, 'nobody@x', ['ally@x'])).rejects.toBeInstanceOf(MergeError);
    await expect(saveMerge(REPO, 'alice@x', ['nobody@x'])).rejects.toBeInstanceOf(MergeError);
    expect(await loadMerges(REPO)).toEqual([]); // nothing persisted by the failures
  });

  it('rejects empty aliases, alias == canonical, and duplicate alias entries', async () => {
    await expect(saveMerge(REPO, 'alice@x', [])).rejects.toBeInstanceOf(MergeError);
    await expect(saveMerge(REPO, 'alice@x', ['alice@x'])).rejects.toBeInstanceOf(MergeError);
    await expect(saveMerge(REPO, 'alice@x', ['ally@x', 'ally@x'])).rejects.toBeInstanceOf(MergeError);
  });

  it('rejects overlapping merges: an alias that is another canonical, and vice versa', async () => {
    await saveMerge(REPO, 'alice@x', ['ally@x']);
    await expect(saveMerge(REPO, 'ally@x', ['bob@x'])).rejects.toBeInstanceOf(MergeError);
    await expect(saveMerge(REPO, 'bob@x', ['alice@x'])).rejects.toBeInstanceOf(MergeError);
  });

  it('rejects merge operations on an unknown repo', async () => {
    await expect(saveMerge('missing', 'alice@x', ['ally@x'])).rejects.toBeInstanceOf(RepoNotFoundError);
    await expect(loadMerges('missing')).rejects.toBeInstanceOf(RepoNotFoundError);
    await expect(deleteMerge('missing', 'alice@x')).rejects.toBeInstanceOf(RepoNotFoundError);
  });

  it('rejects undoing a merge that does not exist', async () => {
    await expect(deleteMerge(REPO, 'bob@x')).rejects.toBeInstanceOf(MergeError);
  });
});

describe('authorMetrics with merges — recomputed ownership from stored rows', () => {
  it('no merges leaves author metrics untouched', () => {
    const authors = authorMetrics(storedLog, {}, []);
    expect(authors.map((a) => a.email).sort()).toEqual(['alice@x', 'ally@x', 'bob@x']);
  });

  it('folds the alias into the canonical: churn summed, mods unioned, ownership renormalised', () => {
    const authors = authorMetrics(storedLog, {}, [{ canonicalEmail: 'alice@x', aliases: ['ally@x'] }]);
    expect(authors).toHaveLength(2);
    const alice = authors.find((a) => a.email === 'alice@x')!;
    // c1 (λ=10) + c3 (λ=2), modifications {c1, c3}, total churn 22.
    expect(alice.churn).toBe(12);
    expect(alice.modifications).toBe(2);
    expect(alice.ownership).toBeCloseTo(12 / 22, 10);
    const bob = authors.find((a) => a.email === 'bob@x')!;
    expect(bob.churn).toBe(10);
    expect(bob.ownership).toBeCloseTo(10 / 22, 10);
  });

  it('keeps the canonical identity name even when an alias committed more recently', () => {
    const authors = authorMetrics(storedLog, {}, [{ canonicalEmail: 'alice@x', aliases: ['ally@x'] }]);
    // c3 (ally@x, 'Alice A.', 01-03) is newer, but the canonical's own commits name the row.
    expect(authors.find((a) => a.email === 'alice@x')!.name).toBe('Alice');
  });

  it('falls back to an alias name when the canonical has no in-scope commits', () => {
    // docs only has c2 (bob): the merged row shows bob's churn and, lacking any
    // alice@x commit under docs, bob's name as the fallback.
    const authors = authorMetrics(storedLog, { path: 'docs' }, [
      { canonicalEmail: 'alice@x', aliases: ['bob@x'] },
    ]);
    expect(authors).toHaveLength(1);
    expect(authors[0]).toMatchObject({ email: 'alice@x', name: 'Bob', churn: 5 });
    expect(authors[0].ownership).toBeCloseTo(1, 10);
  });

  it('combines merges with a path filter and ownership recomputes on the filtered total', () => {
    // Under src: c1 (10/0) + c2 (3/2) + c3 (1/1) → alice 12, bob 5, total 17.
    const authors = authorMetrics(storedLog, { path: 'src' }, [
      { canonicalEmail: 'alice@x', aliases: ['ally@x'] },
    ]);
    expect(authors.find((a) => a.email === 'alice@x')!.ownership).toBeCloseTo(12 / 17, 10);
    expect(authors.find((a) => a.email === 'bob@x')!.ownership).toBeCloseTo(5 / 17, 10);
  });

  it('combines merges with a commit-set filter', () => {
    // Only c2 (bob, λ=10) and c3 (ally → alice, λ=2): alice 2/12, bob 10/12.
    const authors = authorMetrics(storedLog, { commitSet: { kind: 'list', hashes: ['c2', 'c3'] } }, [
      { canonicalEmail: 'alice@x', aliases: ['ally@x'] },
    ]);
    expect(authors).toHaveLength(2);
    expect(authors.find((a) => a.email === 'alice@x')!.churn).toBe(2);
    expect(authors.find((a) => a.email === 'bob@x')!.churn).toBe(10);
  });
});
