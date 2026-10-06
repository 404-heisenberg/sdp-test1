import { describe, it, expect } from 'vitest';
import { parseNumstatLine } from '../src/git/parseGitLog.js';

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
