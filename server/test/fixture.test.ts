import { describe, it, expect } from 'vitest';
import { runFixtureChecks } from './fixtureVerify.js';

// The 50%-tier verification: scripted fixture repo, both ingestion paths,
// hand-computed values for every metric category. See fixtureRepo.ts for the
// script and the hand computation behind each expected number.
describe('RAT fixture verification (50% tier)', () => {
  it('passes every hand-computed metric check', async () => {
    const results = await runFixtureChecks();
    const failed = results.filter((r) => !r.pass);
    const report = failed.map((f) => `✗ ${f.name} — ${f.detail}`).join('\n');
    expect(report, `fixture verification failures:\n${report}`).toBe('');
    expect(results.length).toBeGreaterThan(10);
  }, 120_000);
});
