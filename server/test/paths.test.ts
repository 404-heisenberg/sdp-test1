import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { repoRoot, getDataDir, getReposDir } from '../src/paths.js';

describe('paths', () => {
  it('resolves the workspace root containing the server and client workspaces', async () => {
    // Regression guard: an off-by-one URL hop once resolved the root one level
    // too high, silently writing data outside the workspace.
    const pkg = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'));
    expect(pkg.workspaces).toContain('server');
    expect(pkg.workspaces).toContain('client');
  });

  it('keeps the default data dir inside the workspace', () => {
    const dataDir = getDataDir();
    if (!process.env.RAT_DATA_DIR) {
      expect(dataDir.startsWith(repoRoot + path.sep)).toBe(true);
    }
    expect(getReposDir().startsWith(dataDir + path.sep)).toBe(true);
  });
});
