import fs from 'node:fs/promises';
import path from 'node:path';
import { runGit } from '../src/git/runner.js';

/**
 * The scripted verification fixture: a tiny repo whose every line count is
 * hand-computed. Covers multiple authors, nested directories, pure rename,
 * rename+edit, deletion, a binary file, and an excluded merge commit.
 *
 * History (all dates fixed; committer date == author date):
 *   c1 alice 2024-01-01: initial — src/app.ts +10, src/util/helpers.ts +6,
 *                        src/util/legacy.ts +4, src/old-name.ts +8
 *   c2 bob   2024-01-02: src/app.ts +3/−2, src/util/helpers.ts +1/−1
 *   c3 bob   2024-01-03: src/app.ts +2/−2
 *   c4 carol 2024-01-04: docs/guide.md +4
 *   c5 alice 2024-01-05: delete src/util/legacy.ts (−4)
 *   c6 bob   2024-01-06: pure rename src/old-name.ts → src/moved.ts (0/0)
 *   c7 alice 2024-01-07: binary assets/logo.png (excluded)
 *   c8 carol 2024-01-08: rename+edit src/app.ts → src/core.ts (+1, new path)
 *   c9 bob   2024-01-09 (branch feature): src/feature.ts +5
 *   m1 alice 2024-01-10: merge feature into main — EXCLUDED from metrics
 */

export const AUTHORS = {
  alice: { name: 'Alice Dev', email: 'alice@example.com' },
  bob: { name: 'Bob Dev', email: 'bob@example.com' },
  carol: { name: 'Carol Dev', email: 'carol@example.com' },
} as const;

interface CommitSpec {
  message: string;
  author: { name: string; email: string };
  date: string;
}

const lines = (names: string[]): string => names.join('\n') + '\n';
const seq = (prefix: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

async function commit(dir: string, spec: CommitSpec): Promise<void> {
  const env = {
    GIT_AUTHOR_NAME: spec.author.name,
    GIT_AUTHOR_EMAIL: spec.author.email,
    GIT_COMMITTER_NAME: spec.author.name,
    GIT_COMMITTER_EMAIL: spec.author.email,
    GIT_AUTHOR_DATE: spec.date,
    GIT_COMMITTER_DATE: spec.date,
  };
  await runGit(dir, ['commit', '-m', spec.message, '--no-verify'], { env });
}

async function write(dir: string, rel: string, content: string | Buffer): Promise<void> {
  const file = path.join(dir, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

// A buffer with NUL bytes — git classifies blobs containing NUL as binary.
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
  0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00,
  0x00, 0x1f, 0x15, 0xc4, 0x89,
]);

/**
 * Create the scripted fixture repository at `dir` and return a map from commit
 * message (unique) to full hash, plus the merge commit's hash.
 */
export async function createFixtureRepo(
  dir: string,
): Promise<{ bySubject: Map<string, string>; mergeHash: string }> {
  await fs.mkdir(dir, { recursive: true });
  await runGit(dir, ['init', '-b', 'main']);

  // c1 — alice: four files across nested directories.
  await write(dir, 'src/app.ts', lines(seq('A', 10)));
  await write(dir, 'src/util/helpers.ts', lines(seq('H', 6)));
  await write(dir, 'src/util/legacy.ts', lines(seq('L', 4)));
  await write(dir, 'src/old-name.ts', lines(seq('O', 8)));
  await runGit(dir, ['add', '-A']);
  await commit(dir, { message: 'c1 initial', author: AUTHORS.alice, date: '2024-01-01T10:00:00Z' });

  // c2 — bob: app.ts +3/−2 (drop A9,A10; add B1..B3), helpers.ts +1/−1 (H3 → X).
  await write(dir, 'src/app.ts', lines([...seq('A', 8), 'B1', 'B2', 'B3']));
  await write(dir, 'src/util/helpers.ts', lines(['H1', 'H2', 'X', 'H4', 'H5', 'H6']));
  await runGit(dir, ['add', '-A']);
  await commit(dir, { message: 'c2 bob edits', author: AUTHORS.bob, date: '2024-01-02T10:00:00Z' });

  // c3 — bob: app.ts +2/−2 (B1,B2 → C1,C2).
  await write(dir, 'src/app.ts', lines([...seq('A', 8), 'C1', 'C2', 'B3']));
  await runGit(dir, ['add', '-A']);
  await commit(dir, { message: 'c3 more app edits', author: AUTHORS.bob, date: '2024-01-03T10:00:00Z' });

  // c4 — carol: docs.
  await write(dir, 'docs/guide.md', lines(seq('G', 4)));
  await runGit(dir, ['add', '-A']);
  await commit(dir, { message: 'c4 docs', author: AUTHORS.carol, date: '2024-01-04T10:00:00Z' });

  // c5 — alice: deletion (removed lines on the deleted path).
  await runGit(dir, ['rm', 'src/util/legacy.ts']);
  await commit(dir, { message: 'c5 remove legacy', author: AUTHORS.alice, date: '2024-01-05T10:00:00Z' });

  // c6 — bob: pure rename, zero churn.
  await runGit(dir, ['mv', 'src/old-name.ts', 'src/moved.ts']);
  await commit(dir, { message: 'c6 pure rename', author: AUTHORS.bob, date: '2024-01-06T10:00:00Z' });

  // c7 — alice: binary asset, excluded from all line metrics.
  await write(dir, 'assets/logo.png', PNG_BYTES);
  await runGit(dir, ['add', '-A']);
  await commit(dir, { message: 'c7 binary asset', author: AUTHORS.alice, date: '2024-01-07T10:00:00Z' });

  // c8 — carol: rename + edit — all changes attributed to the NEW path.
  await runGit(dir, ['mv', 'src/app.ts', 'src/core.ts']);
  await write(dir, 'src/core.ts', lines([...seq('A', 8), 'C1', 'C2', 'B3', 'D1']));
  await runGit(dir, ['add', '-A']);
  await commit(dir, { message: 'c8 rename with edit', author: AUTHORS.carol, date: '2024-01-08T10:00:00Z' });

  // c9 — bob: feature work on a side branch.
  await runGit(dir, ['checkout', '-b', 'feature']);
  await write(dir, 'src/feature.ts', lines(seq('F', 5)));
  await runGit(dir, ['add', '-A']);
  await commit(dir, { message: 'c9 feature work', author: AUTHORS.bob, date: '2024-01-09T10:00:00Z' });

  // m1 — merge feature into main (excluded from every metric).
  await runGit(dir, ['checkout', 'main']);
  const mergeEnv = {
    GIT_AUTHOR_NAME: AUTHORS.alice.name,
    GIT_AUTHOR_EMAIL: AUTHORS.alice.email,
    GIT_COMMITTER_NAME: AUTHORS.alice.name,
    GIT_COMMITTER_EMAIL: AUTHORS.alice.email,
    GIT_AUTHOR_DATE: '2024-01-10T10:00:00Z',
    GIT_COMMITTER_DATE: '2024-01-10T10:00:00Z',
  };
  await runGit(dir, ['merge', '--no-ff', 'feature', '-m', 'm1 merge feature'], { env: mergeEnv });

  const log = await runGit(dir, ['log', '--format=%H %s']);
  const bySubject = new Map<string, string>();
  for (const line of log.trim().split('\n')) {
    const sp = line.indexOf(' ');
    bySubject.set(line.slice(sp + 1), line.slice(0, sp));
  }
  return { bySubject, mergeHash: bySubject.get('m1 merge feature')! };
}
