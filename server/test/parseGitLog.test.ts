import { describe, it, expect } from 'vitest';
import { parseNumstatLine, createLogAccumulator } from '../src/git/parseGitLog.js';
import { parseGitLogOutput } from '../src/git/runner.js';

describe('parseNumstatLine', () => {
  it('parses a plain added/removed/path row', () => {
    expect(parseNumstatLine('10\t2\tsrc/main.ts')).toEqual({
      path: 'src/main.ts',
      added: 10,
      removed: 2,
    });
  });

  it('parses a deletion row (0 removed N)', () => {
    expect(parseNumstatLine('0\t5\told/removed.txt')).toEqual({
      path: 'old/removed.txt',
      added: 0,
      removed: 5,
    });
  });

  it('parses a rename with leading dirs equal: "0\t0\tsrc/{a.ts => b.ts}" -> new full path', () => {
    expect(parseNumstatLine('0\t0\tsrc/{a.ts => b.ts}')).toEqual({
      path: 'src/b.ts',
      added: 0,
      removed: 0,
    });
  });

  it('parses rename+edit attributing adds/removes to the new path', () => {
    expect(parseNumstatLine('3\t1\t{a.ts => b.ts}')).toEqual({
      path: 'b.ts',
      added: 3,
      removed: 1,
    });
  });

  it('parses full rename "old => new" form', () => {
    expect(parseNumstatLine('0\t0\told/x.ts => new/y.ts')).toEqual({
      path: 'new/y.ts',
      added: 0,
      removed: 0,
    });
  });

  it('parses brace rename with only tails differing across dirs', () => {
    // src/{a/x.ts => b/y.ts}: oldPart "src/a/x.ts", newPart "src/b/y.ts"
    expect(parseNumstatLine('2\t0\tsrc/{a/x.ts => b/y.ts}')).toEqual({
      path: 'src/b/y.ts',
      added: 2,
      removed: 0,
    });
  });

  it('skips binary rows (dash numstat)', () => {
    expect(parseNumstatLine('-\t-\tbin/logo.png')).toBeNull();
  });

  it('skips binary rename rows', () => {
    expect(parseNumstatLine('-\t-\tsrc/{a.png => b.png}')).toBeNull();
  });

  it('returns null for junk', () => {
    expect(parseNumstatLine('')).toBeNull();
    expect(parseNumstatLine('garbage')).toBeNull();
  });
});

const SAMPLE = [
  'hash1\x1fAlice\x1falice@example.com\x1f2026-01-01T00:00:00+00:00\x1ffirst',
  '10\t2\tsrc/main.ts',
  '-\t-\tbin/logo.png',
  '0\t5\told/removed.txt',
  '',
  'hash2\x1fBob\x1fbob@example.com\x1f2026-01-02T00:00:00+00:00\x1frename',
  '0\t0\tsrc/{a.ts => b.ts}',
  '3\t1\tsrc/deep/{x/y.ts => z/y.ts}',
  '0\t0\told/x.ts => new/y.ts',
  '',
  'hash3\x1fAlice\x1falice@example.com\x1f2026-01-03T00:00:00+00:00\x1flast',
  '1\t0\tREADME.md',
  '',
].join('\n');

describe('createLogAccumulator (streamed parsing)', () => {
  it('matches the batch parser when fed in arbitrary chunk splits', () => {
    const batch = parseGitLogOutput(SAMPLE);
    const acc = createLogAccumulator();
    for (const chunk of SAMPLE.match(/[\s\S]{1,7}/g) ?? []) acc.push(chunk);
    expect(acc.result()).toEqual(batch);
  });

  it('counts commits and rows for progress reporting', () => {
    const acc = createLogAccumulator();
    acc.push(SAMPLE);
    expect(acc.counts()).toEqual({ commits: 3, rows: 6 });
  });

  it('does not count binary rows or pre-commit junk', () => {
    const acc = createLogAccumulator();
    acc.push('-\t-\tbin.png\ngarbage line\n');
    expect(acc.counts()).toEqual({ commits: 0, rows: 0 });
  });
});
