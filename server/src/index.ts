import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { createApiRouter, apiErrorHandler } from './api.js';
import { getReposDir, repoRoot } from './paths.js';

const PORT = Number(process.env.PORT ?? 3001);

async function main() {
  await fs.mkdir(getReposDir(), { recursive: true });

  const app = express();
  app.use('/api', createApiRouter());
  app.use('/api', apiErrorHandler);

  // Production single-process mode: serve the built client.
  const clientDist = path.join(repoRoot, 'client', 'dist');
  try {
    await fs.access(clientDist);
    app.use(express.static(clientDist));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  } catch {
    // No build yet (dev mode: Vite serves the client and proxies /api).
  }

  app.listen(PORT, () => {
    console.log(`RAT server listening on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
