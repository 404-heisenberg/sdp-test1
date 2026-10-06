import { runFixtureChecks } from '../test/fixtureVerify.js';

// Standalone fixture verification script — the 50%-tier correctness gate.
// Usage: npm run verify (from server/, or `npm run verify` at the root).
const results = await runFixtureChecks();
for (const r of results) {
  console.log(`${r.pass ? '✓' : '✗'}  ${r.name}${r.pass ? '' : ` — ${r.detail}`}`);
}
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed > 0) {
  process.exit(1);
}
