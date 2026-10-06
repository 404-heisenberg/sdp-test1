import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { createFixtureRepo, AUTHORS } from './fixtureRepo.js';
import { ingestUrl, ingestZip, IngestError } from '../src/ingest.js';
import { loadLog } from '../src/registry.js';
import { pathMetrics, fileMetrics, authorMetrics } from '../src/metrics/engine.js';
import type { Log, PathMetricsLike } from './fixtureTypes.js';

export interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

const close = (actual: number, expected: number): boolean => Math.abs(actual - expected) < 1e-9;

function expectPathMetrics(
  m: PathMetricsLike,
  expected: Partial<Record<keyof PathMetricsLike, number>>,
): string | undefined {
  for (const [key, want] of Object.entries(expected)) {
    const got = m[key as keyof PathMetricsLike] as number;
    if (typeof want === 'number' && !Number.isInteger(want)) {
      if (!close(got, want)) return `${key}: expected ${want}, got ${got}`;
    } else if (got !== want) {
      return `${key}: expected ${want}, got ${got}`;
    }
  }
  return undefined;
}

/**
 * End-to-end fixture verification: script a tiny repo with known history,
 * ingest it through BOTH paths (deep clone + zip with .git one level deep),
 * and assert hand-computed values for every metric category. Returns one
 * Check per assertion group so the vitest test and the CLI script share it.
 */
export async function runFixtureChecks(): Promise<Check[]> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rat-fixture-'));
  const prevDataDir = process.env.RAT_DATA_DIR;
  process.env.RAT_DATA_DIR = path.join(tmp, 'data');
  const checks: Check[] = [];
  const record = (name: string, fn: () => string | undefined) => {
    try {
      const detail = fn();
      checks.push(detail ? { name, pass: false, detail } : { name, pass: true });
    } catch (err) {
      checks.push({ name, pass: false, detail: (err as Error).message });
    }
  };
  const recordAsync = async (name: string, fn: () => Promise<string | undefined>) => {
    try {
      const detail = await fn();
      checks.push(detail ? { name, pass: false, detail } : { name, pass: true });
    } catch (err) {
      checks.push({ name, pass: false, detail: (err as Error).message });
    }
  };

  try {
    const fixtureDir = path.join(tmp, 'fixture-repo-src');
    const { bySubject } = await createFixtureRepo(fixtureDir);
    const h = (subject: string) => bySubject.get(subject)!;

    // Ingest via URL (deep clone of the fixture).
    const clone = await ingestUrl(`file://${fixtureDir}`);
    // Ingest via zip with .git nested one level deep (wrapper directory).
    const zip = new AdmZip();
    zip.addLocalFolder(fixtureDir, 'fixture-repo');
    const zipPath = path.join(tmp, 'fixture.zip');
    zip.writeZip(zipPath);
    const fromZip = await ingestZip(zipPath);

    const cloneLog: Log = (await loadLog(clone.id)).log;
    const zipLog: Log = (await loadLog(fromZip.id)).log;

    // ── Commit set / exclusions ──────────────────────────────────────────────
    record('commits: exactly the 9 non-merge commits (merge excluded)', () => {
      if (cloneLog.commits.length !== 9) {
        return `expected 9 commits, got ${cloneLog.commits.length}`;
      }
      if (cloneLog.commits.some((c) => c.hash === h('m1 merge feature'))) {
        return 'merge commit leaked into the commit set';
      }
      return undefined;
    });

    record('binary file excluded from all rows', () =>
      cloneLog.rows.some((r) => r.path === 'assets/logo.png')
        ? 'assets/logo.png produced line rows'
        : undefined,
    );

    // ── Repository (root) metrics ────────────────────────────────────────────
    record('repository metrics (root directory)', () =>
      expectPathMetrics(pathMetrics(cloneLog), {
        added: 44,
        removed: 9,
        growth: 35,
        churn: 53,
        modifications: 7,
        commitSetSize: 9,
        modificationFrequency: 7 / 9,
        churnRate: 53 / 9,
      }),
    );

    // ── Per-file metrics ─────────────────────────────────────────────────────
    const files = fileMetrics(cloneLog);
    const fileCases: Array<[string, Partial<Record<keyof PathMetricsLike, number>>]> = [
      ['src/app.ts', { added: 15, removed: 4, growth: 11, churn: 19, modifications: 3, modificationFrequency: 3 / 9, churnRate: 19 / 9 }],
      ['src/core.ts', { added: 1, removed: 0, growth: 1, churn: 1, modifications: 1, churnRate: 1 / 9 }], // rename+edit → new path
      ['src/moved.ts', { added: 0, removed: 0, growth: 0, churn: 0, modifications: 0 }], // pure rename → zero churn
      ['src/old-name.ts', { added: 8, removed: 0, growth: 8, churn: 8, modifications: 1 }],
      ['src/util/helpers.ts', { added: 7, removed: 1, growth: 6, churn: 8, modifications: 2 }],
      ['src/util/legacy.ts', { added: 4, removed: 4, growth: 0, churn: 8, modifications: 2 }], // deletion counts as removed
      ['docs/guide.md', { added: 4, removed: 0, growth: 4, churn: 4, modifications: 1 }],
      ['src/feature.ts', { added: 5, removed: 0, growth: 5, churn: 5, modifications: 1 }],
    ];
    for (const [file, expected] of fileCases) {
      record(`file metrics: ${file}`, () => {
        const f = files.find((x) => x.path === file);
        if (!f) return 'file missing from metrics';
        return expectPathMetrics(f, expected);
      });
    }
    record('binary file absent from file metrics', () =>
      files.some((f) => f.path === 'assets/logo.png') ? 'binary file listed' : undefined,
    );

    // ── Directory metrics (recursive sums) ───────────────────────────────────
    const dirCases: Array<[string, Partial<Record<keyof PathMetricsLike, number>>]> = [
      ['src', { added: 40, removed: 9, growth: 31, churn: 49, modifications: 6, churnRate: 49 / 9 }],
      ['src/util', { added: 11, removed: 5, growth: 6, churn: 16, modifications: 3, churnRate: 16 / 9 }],
      ['docs', { added: 4, removed: 0, growth: 4, churn: 4, modifications: 1 }],
      ['assets', { added: 0, removed: 0, growth: 0, churn: 0, modifications: 0 }], // binary-only dir
    ];
    for (const [dir, expected] of dirCases) {
      record(`directory metrics: ${dir}`, () =>
        expectPathMetrics(pathMetrics(cloneLog, { path: dir }), expected),
      );
    }

    // ── Commit-set metrics ───────────────────────────────────────────────────
    record('commit set: time range [2024-01-02, 2024-01-08) on committer date', () =>
      expectPathMetrics(
        pathMetrics(cloneLog, {
          commitSet: { kind: 'range', from: '2024-01-02T00:00:00Z', to: '2024-01-08T00:00:00Z' },
        }),
        { added: 10, removed: 9, growth: 1, churn: 19, modifications: 4, commitSetSize: 6, modificationFrequency: 4 / 6, churnRate: 19 / 6 },
      ),
    );
    record('commit set: manual list [c1, c9]', () =>
      expectPathMetrics(
        pathMetrics(cloneLog, { commitSet: { kind: 'list', hashes: [h('c1 initial'), h('c9 feature work')] } }),
        { added: 33, removed: 0, growth: 33, churn: 33, modifications: 2, commitSetSize: 2, modificationFrequency: 1, churnRate: 16.5 },
      ),
    );
    record('commit set: empty list guards (eta = rho = 0)', () =>
      expectPathMetrics(pathMetrics(cloneLog, { commitSet: { kind: 'list', hashes: [] } }), {
        added: 0, removed: 0, growth: 0, churn: 0, modifications: 0, commitSetSize: 0, modificationFrequency: 0, churnRate: 0,
      }),
    );

    // ── Combined filters (T3): author × commit set × path ───────────────────
    // alice: c1 (+28/0), c5 (0/4), c7 (binary — no rows) → |H| = 3.
    record('filters: author restricts H and sums (alice)', () =>
      expectPathMetrics(pathMetrics(cloneLog, { author: AUTHORS.alice.email }), {
        added: 28, removed: 4, growth: 24, churn: 32, modifications: 2, commitSetSize: 3,
        modificationFrequency: 2 / 3, churnRate: 32 / 3,
      }),
    );
    // bob in [01-02, 01-06): c2 (+4/3) + c3 (+2/2) → churn 11 over |H| = 2.
    record('filters: author + time range combine (bob)', () =>
      expectPathMetrics(
        pathMetrics(cloneLog, {
          author: AUTHORS.bob.email,
          commitSet: { kind: 'range', from: '2024-01-02T00:00:00Z', to: '2024-01-06T00:00:00Z' },
        }),
        {
          added: 6, removed: 5, growth: 1, churn: 11, modifications: 2, commitSetSize: 2,
          modificationFrequency: 1, churnRate: 5.5,
        },
      ),
    );
    // carol among [c1, c4, c8]: c4 (docs +4/0) + c8 (core.ts +1/0) → churn 5, |H| = 2.
    record('filters: author + manual list combine (carol)', () =>
      expectPathMetrics(
        pathMetrics(cloneLog, {
          author: AUTHORS.carol.email,
          commitSet: { kind: 'list', hashes: [h('c1 initial'), h('c4 docs'), h('c8 rename with edit')] },
        }),
        {
          added: 5, removed: 0, growth: 5, churn: 5, modifications: 2, commitSetSize: 2,
          modificationFrequency: 1, churnRate: 2.5,
        },
      ),
    );
    // [c1, c4] scoped to docs: only c4's guide.md (+4/0), but |H| stays 2.
    record('filters: manual list + path scope combine', () =>
      expectPathMetrics(
        pathMetrics(cloneLog, {
          path: 'docs',
          commitSet: { kind: 'list', hashes: [h('c1 initial'), h('c4 docs')] },
        }),
        {
          added: 4, removed: 0, growth: 4, churn: 4, modifications: 1, commitSetSize: 2,
          modificationFrequency: 0.5, churnRate: 2,
        },
      ),
    );
    record('filters: unknown author yields guarded zeros', () =>
      expectPathMetrics(pathMetrics(cloneLog, { author: 'nobody@example.com' }), {
        added: 0, removed: 0, growth: 0, churn: 0, modifications: 0, commitSetSize: 0, modificationFrequency: 0, churnRate: 0,
      }),
    );
    record('filters: author metrics under an author filter collapse to one owner', () => {
      const authors = authorMetrics(cloneLog, { author: AUTHORS.alice.email });
      if (authors.length !== 1) return `expected 1 author, got ${authors.length}`;
      const alice = authors[0];
      if (alice.email !== AUTHORS.alice.email || alice.churn !== 32 || !close(alice.ownership, 1)) {
        return `alice: churn ${alice.churn}, own ${alice.ownership}`;
      }
      return undefined;
    });

    // ── Author metrics ───────────────────────────────────────────────────────
    record('author metrics: whole repository', () => {
      const authors = authorMetrics(cloneLog);
      if (authors.length !== 3) return `expected 3 authors, got ${authors.length}`;
      const problems: string[] = [];
      const alice = authors.find((a) => a.email === AUTHORS.alice.email)!;
      const bob = authors.find((a) => a.email === AUTHORS.bob.email)!;
      const carol = authors.find((a) => a.email === AUTHORS.carol.email)!;
      if (alice.churn !== 32 || alice.modifications !== 2 || !close(alice.ownership, 32 / 53)) {
        problems.push(`alice: churn ${alice.churn}, mods ${alice.modifications}, own ${alice.ownership}`);
      }
      if (bob.churn !== 16 || bob.modifications !== 3 || !close(bob.ownership, 16 / 53)) {
        problems.push(`bob: churn ${bob.churn}, mods ${bob.modifications}, own ${bob.ownership}`);
      }
      if (carol.churn !== 5 || carol.modifications !== 2 || !close(carol.ownership, 5 / 53)) {
        problems.push(`carol: churn ${carol.churn}, mods ${carol.modifications}, own ${carol.ownership}`);
      }
      return problems.length ? problems.join('; ') : undefined;
    });

    record('author metrics: scoped to src/util', () => {
      const authors = authorMetrics(cloneLog, { path: 'src/util' });
      if (authors.length !== 2) return `expected 2 authors under src/util, got ${authors.length}`;
      const problems: string[] = [];
      const alice = authors.find((a) => a.email === AUTHORS.alice.email)!;
      const bob = authors.find((a) => a.email === AUTHORS.bob.email)!;
      if (alice.churn !== 14 || alice.modifications !== 2 || !close(alice.ownership, 14 / 16)) {
        problems.push(`alice: churn ${alice.churn}, mods ${alice.modifications}, own ${alice.ownership}`);
      }
      if (bob.churn !== 2 || bob.modifications !== 1 || !close(bob.ownership, 2 / 16)) {
        problems.push(`bob: churn ${bob.churn}, mods ${bob.modifications}, own ${bob.ownership}`);
      }
      return problems.length ? problems.join('; ') : undefined;
    });

    // ── Zip ≡ clone ──────────────────────────────────────────────────────────
    record('zip ingestion produces metrics identical to the clone', () =>
      JSON.stringify(zipLog) === JSON.stringify(cloneLog)
        ? undefined
        : `row stores differ: zip rows ${zipLog.rows.length} vs clone rows ${cloneLog.rows.length}`,
    );

    // ── Error paths ──────────────────────────────────────────────────────────
    await recordAsync('zip without .git is rejected with a clear error', async () => {
      const plainDir = path.join(tmp, 'no-git');
      await fs.mkdir(plainDir, { recursive: true });
      await fs.writeFile(path.join(plainDir, 'readme.txt'), 'not a repo\n');
      const plainZip = new AdmZip();
      plainZip.addLocalFolder(plainDir, 'no-git');
      const plainZipPath = path.join(tmp, 'no-git.zip');
      plainZip.writeZip(plainZipPath);
      try {
        await ingestZip(plainZipPath);
        return 'ingestion unexpectedly succeeded';
      } catch (err) {
        const msg = (err as Error).message;
        return msg.includes('.git') ? undefined : `error message lacks .git context: ${msg}`;
      }
    });

    await recordAsync('failed clone is rejected with a clear error', async () => {
      try {
        await ingestUrl('file:///nonexistent/rat-repo-that-does-not-exist');
        return 'clone of a nonexistent repo unexpectedly succeeded';
      } catch (err) {
        return err instanceof IngestError ? undefined : `wrong error type: ${(err as Error).message}`;
      }
    });
  } finally {
    process.env.RAT_DATA_DIR = prevDataDir;
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
  return checks;
}
