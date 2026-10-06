import { describe, it, expect } from 'vitest';
import {
  pathMetrics,
  fileMetrics,
  authorMetrics,
  treeMetrics,
  fileHistory,
} from '../src/metrics/engine.js';
import type { Log } from '../src/git/parseGitLog.js';

// Synthetic log, hand-computed expectations.
// History (oldest first):
//   c1 alice: src/a.ts +10/0
//   c2 bob:   src/a.ts +3/2, docs/readme.md +5/0
//   c3 alice: src/b.ts 0/4        (deletion)
//   c4 bob:   src/a.ts +2/2, src/renamed.ts 0/0  (pure rename row)
//   c5 alice: src/c.ts +7/0
const log: Log = {
  commits: [
    { hash: 'c5', authorName: 'Alice', authorEmail: 'alice@x', date: '2024-01-05T10:00:00Z', subject: 'c5' },
    { hash: 'c4', authorName: 'Bob', authorEmail: 'bob@x', date: '2024-01-04T10:00:00Z', subject: 'c4' },
    { hash: 'c3', authorName: 'Alice', authorEmail: 'alice@x', date: '2024-01-03T10:00:00Z', subject: 'c3' },
    { hash: 'c2', authorName: 'Bob', authorEmail: 'bob@x', date: '2024-01-02T10:00:00Z', subject: 'c2' },
    { hash: 'c1', authorName: 'Alice', authorEmail: 'alice@x', date: '2024-01-01T10:00:00Z', subject: 'c1' },
  ],
  rows: [
    { hash: 'c1', path: 'src/a.ts', added: 10, removed: 0 },
    { hash: 'c2', path: 'src/a.ts', added: 3, removed: 2 },
    { hash: 'c2', path: 'docs/readme.md', added: 5, removed: 0 },
    { hash: 'c3', path: 'src/b.ts', added: 0, removed: 4 },
    { hash: 'c4', path: 'src/a.ts', added: 2, removed: 2 },
    { hash: 'c4', path: 'src/renamed.ts', added: 0, removed: 0 },
    { hash: 'c5', path: 'src/c.ts', added: 7, removed: 0 },
  ],
};

describe('pathMetrics — repository (root) metrics', () => {
  it('computes root sums, modifications, frequency and churn rate over all commits', () => {
    const m = pathMetrics(log);
    expect(m.path).toBe('');
    expect(m.added).toBe(27);
    expect(m.removed).toBe(8);
    expect(m.growth).toBe(19);
    expect(m.churn).toBe(35);
    expect(m.modifications).toBe(5);
    expect(m.commitSetSize).toBe(5);
    expect(m.modificationFrequency).toBeCloseTo(1, 10);
    expect(m.churnRate).toBeCloseTo(7, 10);
  });

  it('computes directory metrics as recursive sums below the directory', () => {
    const m = pathMetrics(log, { path: 'src' });
    expect(m.added).toBe(22);
    expect(m.removed).toBe(8);
    expect(m.growth).toBe(14);
    expect(m.churn).toBe(30);
    expect(m.modifications).toBe(5);
    expect(m.churnRate).toBeCloseTo(6, 10);
  });

  it('computes file metrics by exact path', () => {
    const m = pathMetrics(log, { path: 'src/a.ts' });
    expect(m.added).toBe(15);
    expect(m.removed).toBe(4);
    expect(m.growth).toBe(11);
    expect(m.churn).toBe(19);
    expect(m.modifications).toBe(3);
    expect(m.modificationFrequency).toBeCloseTo(0.6, 10);
    expect(m.churnRate).toBeCloseTo(3.8, 10);
  });

  it('normalises leading/trailing slashes on the path filter', () => {
    const m = pathMetrics(log, { path: '/src/' });
    expect(m.churn).toBe(30);
  });
});

describe('pathMetrics — commit sets', () => {
  it('filters by committer-date range (from inclusive, to exclusive)', () => {
    const m = pathMetrics(log, {
      commitSet: { kind: 'range', from: '2024-01-02T00:00:00Z', to: '2024-01-04T00:00:00Z' },
    });
    expect(m.commitSetSize).toBe(2); // c2, c3
    expect(m.added).toBe(8);
    expect(m.removed).toBe(6);
    expect(m.growth).toBe(2);
    expect(m.churn).toBe(14);
    expect(m.modifications).toBe(2);
  });

  it('supports an open-ended range (from only)', () => {
    const m = pathMetrics(log, { commitSet: { kind: 'range', from: '2024-01-03T00:00:00Z' } });
    expect(m.commitSetSize).toBe(3); // c3, c4, c5
    expect(m.added).toBe(9);
    expect(m.churn).toBe(15);
    expect(m.churnRate).toBeCloseTo(5, 10);
  });

  it('filters by an explicit list of commit hashes', () => {
    const m = pathMetrics(log, { commitSet: { kind: 'list', hashes: ['c1', 'c4'] } });
    expect(m.commitSetSize).toBe(2);
    expect(m.added).toBe(12);
    expect(m.removed).toBe(2);
    expect(m.churn).toBe(14);
    expect(m.modifications).toBe(2);
  });

  it('guards against an empty commit set (eta and rho are 0)', () => {
    const m = pathMetrics(log, { commitSet: { kind: 'list', hashes: [] } });
    expect(m.commitSetSize).toBe(0);
    expect(m.added).toBe(0);
    expect(m.churn).toBe(0);
    expect(m.modifications).toBe(0);
    expect(m.modificationFrequency).toBe(0);
    expect(m.churnRate).toBe(0);
  });
});

describe('fileMetrics', () => {
  it('aggregates every file, sorted by churn descending', () => {
    const files = fileMetrics(log);
    expect(files.map((f) => f.path)).toEqual([
      'src/a.ts',
      'src/c.ts',
      'docs/readme.md',
      'src/b.ts',
      'src/renamed.ts',
    ]);
    const a = files.find((f) => f.path === 'src/a.ts')!;
    expect(a.added).toBe(15);
    expect(a.removed).toBe(4);
    expect(a.churn).toBe(19);
    expect(a.modifications).toBe(3);
    expect(a.modificationFrequency).toBeCloseTo(0.6, 10);
    expect(a.churnRate).toBeCloseTo(3.8, 10);

    const pureRename = files.find((f) => f.path === 'src/renamed.ts')!;
    expect(pureRename.churn).toBe(0); // pure rename contributes zero churn
    expect(pureRename.modifications).toBe(0); // and is not a modification (lambda = 0)

    const deleted = files.find((f) => f.path === 'src/b.ts')!;
    expect(deleted.removed).toBe(4);
    expect(deleted.growth).toBe(-4);
  });

  it('honours a commit-set filter', () => {
    const files = fileMetrics(log, { commitSet: { kind: 'list', hashes: ['c2'] } });
    expect(files).toHaveLength(2);
    const readme = files.find((f) => f.path === 'docs/readme.md')!;
    expect(readme.churn).toBe(5);
    expect(readme.modificationFrequency).toBeCloseTo(1, 10);
  });
});

describe('authorMetrics', () => {
  it('computes author modifications, churn and ownership over the whole repo', () => {
    const authors = authorMetrics(log);
    expect(authors).toHaveLength(2);
    const alice = authors.find((a) => a.email === 'alice@x')!;
    expect(alice.name).toBe('Alice');
    expect(alice.modifications).toBe(3);
    expect(alice.churn).toBe(21); // 10 + 4 + 7
    expect(alice.ownership).toBeCloseTo(0.6, 10); // 21/35
    const bob = authors.find((a) => a.email === 'bob@x')!;
    expect(bob.modifications).toBe(2);
    expect(bob.churn).toBe(14); // (3+2+5) + (2+2)
    expect(bob.ownership).toBeCloseTo(0.4, 10);
  });

  it('scopes author metrics to a path filter with ownership against that path total', () => {
    const authors = authorMetrics(log, { path: 'src' });
    const alice = authors.find((a) => a.email === 'alice@x')!;
    expect(alice.churn).toBe(21);
    expect(alice.ownership).toBeCloseTo(0.7, 10); // 21/30
    const bob = authors.find((a) => a.email === 'bob@x')!;
    expect(bob.churn).toBe(9);
    expect(bob.ownership).toBeCloseTo(0.3, 10);
  });

  it('guards ownership when total churn is 0', () => {
    const empty: Log = {
      commits: [{ hash: 'c1', authorName: 'A', authorEmail: 'a@x', date: '2024-01-01T00:00:00Z', subject: 'c1' }],
      rows: [{ hash: 'c1', path: 'f.txt', added: 0, removed: 0 }],
    };
    const authors = authorMetrics(empty);
    expect(authors).toHaveLength(1);
    expect(authors[0].churn).toBe(0);
    expect(authors[0].ownership).toBe(0);
  });

  it('honours a commit-set filter', () => {
    const authors = authorMetrics(log, { commitSet: { kind: 'list', hashes: ['c1', 'c5'] } });
    expect(authors).toHaveLength(1);
    expect(authors[0].email).toBe('alice@x');
    expect(authors[0].churn).toBe(17);
  });
});

describe('treeMetrics — immediate children of a directory', () => {
  it('lists root children as directories with recursive sums', () => {
    const children = treeMetrics(log);
    expect(children.map((c) => `${c.kind}:${c.path}`)).toEqual(['dir:src', 'dir:docs']);
    const src = children[0];
    expect(src.added).toBe(22); // 10 + 3 + 2 + 7
    expect(src.removed).toBe(8); // 2 + 4 + 2
    expect(src.growth).toBe(14);
    expect(src.churn).toBe(30);
    expect(src.modifications).toBe(5); // every commit touches src
    expect(src.commitSetSize).toBe(5);
    expect(src.modificationFrequency).toBeCloseTo(1, 10);
    expect(src.churnRate).toBeCloseTo(6, 10);
    const docs = children[1];
    expect(docs.added).toBe(5);
    expect(docs.removed).toBe(0);
    expect(docs.modifications).toBe(1);
    expect(docs.modificationFrequency).toBeCloseTo(0.2, 10);
    expect(docs.churnRate).toBeCloseTo(1, 10);
  });

  it('lists the files inside a directory, sorted by churn', () => {
    const children = treeMetrics(log, { path: 'src' });
    expect(children.map((c) => `${c.kind}:${c.path}`)).toEqual([
      'file:src/a.ts',
      'file:src/c.ts',
      'file:src/b.ts',
      'file:src/renamed.ts',
    ]);
    const a = children[0];
    expect(a.added).toBe(15);
    expect(a.removed).toBe(4);
    expect(a.churn).toBe(19);
    expect(a.modifications).toBe(3);
    expect(a.modificationFrequency).toBeCloseTo(0.6, 10);
    expect(a.churnRate).toBeCloseTo(3.8, 10);
    expect(children[3].churn).toBe(0); // pure rename row only
  });

  it('honours a commit-set filter', () => {
    const children = treeMetrics(log, { commitSet: { kind: 'list', hashes: ['c2'] } });
    expect(children).toHaveLength(2);
    for (const c of children) {
      expect(c.commitSetSize).toBe(1);
      expect(c.modifications).toBe(1);
      expect(c.modificationFrequency).toBeCloseTo(1, 10);
    }
    expect(children.find((c) => c.path === 'src')!.churn).toBe(5); // +3/2
    expect(children.find((c) => c.path === 'docs')!.churn).toBe(5); // +5/0
  });

  it('returns no children for an empty commit set', () => {
    expect(treeMetrics(log, { commitSet: { kind: 'list', hashes: [] } })).toEqual([]);
  });

  it('returns no children for a path with no rows below it', () => {
    expect(treeMetrics(log, { path: 'nope' })).toEqual([]);
  });
});

describe('fileHistory — per-commit adds/removes for a path', () => {
  it('lists commits newest-first with their adds/removes and commit context', () => {
    const history = fileHistory(log, { path: 'src/a.ts' });
    expect(history.map((h) => h.hash)).toEqual(['c4', 'c2', 'c1']);
    expect(history[0]).toEqual({
      hash: 'c4',
      authorName: 'Bob',
      date: '2024-01-04T10:00:00Z',
      subject: 'c4',
      added: 2,
      removed: 2,
    });
    expect(history[1].added).toBe(3);
    expect(history[1].removed).toBe(2);
    expect(history[2]).toMatchObject({ hash: 'c1', added: 10, removed: 0 });
  });

  it('attributes pure renames to the new path with zero churn', () => {
    const history = fileHistory(log, { path: 'src/renamed.ts' });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ hash: 'c4', added: 0, removed: 0 });
  });

  it('sums a directory per commit over everything below it', () => {
    const history = fileHistory(log, { path: 'src' });
    expect(history.map((h) => [h.hash, h.added, h.removed])).toEqual([
      ['c5', 7, 0],
      ['c4', 2, 2],
      ['c3', 0, 4],
      ['c2', 3, 2],
      ['c1', 10, 0],
    ]);
  });

  it('honours a commit-set filter and returns [] for untouched paths', () => {
    const history = fileHistory(log, {
      path: 'docs/readme.md',
      commitSet: { kind: 'range', from: '2024-01-02T00:00:00Z', to: '2024-01-04T00:00:00Z' },
    });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ hash: 'c2', added: 5, removed: 0 });
    expect(fileHistory(log, { path: 'missing.txt' })).toEqual([]);
  });
});
