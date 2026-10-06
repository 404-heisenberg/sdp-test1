import fs from 'node:fs/promises';
import { createFixtureRepo } from '../test/fixtureRepo.js';

// Creates a fresh fixture repo for manual/live API smoke testing.
const dir = process.argv[2];
if (!dir) {
  console.error('Usage: npx tsx scripts/make-fixture.ts <target-dir>');
  process.exit(1);
}
await fs.rm(dir, { recursive: true, force: true });
await createFixtureRepo(dir);
console.log(`fixture repo ready at ${dir}`);
