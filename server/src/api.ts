import fs from 'node:fs/promises';
import path from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { ingestUrl, ingestZip, IngestError } from './ingest.js';
import {
  listRepos,
  repoView,
  listCommits,
  deleteRepo,
  RepoNotFoundError,
  loadLog,
} from './registry.js';
import { getDataDir } from './paths.js';
import { fileMetrics, authorMetrics } from './metrics/engine.js';
import type { CommitSetSelection } from './metrics/engine.js';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Parse the commit-set query params: from/to (ISO, [from, to)) or hashes (CSV). */
function parseCommitSet(query: Request['query']): CommitSetSelection | undefined {
  const from = typeof query.from === 'string' && query.from !== '' ? query.from : undefined;
  const to = typeof query.to === 'string' && query.to !== '' ? query.to : undefined;
  const hashesRaw = typeof query.hashes === 'string' ? query.hashes : undefined;
  if (from === undefined && to === undefined && hashesRaw === undefined) return undefined;
  if (hashesRaw !== undefined && (from !== undefined || to !== undefined)) {
    throw new HttpError(400, 'Pass either a date range (from/to) or a commit list (hashes), not both.');
  }
  if (hashesRaw !== undefined) {
    return { kind: 'list', hashes: hashesRaw.split(',').map((h) => h.trim()).filter(Boolean) };
  }
  return { kind: 'range', from, to };
}

function parseMetricsQuery(req: Request) {
  const commitSet = parseCommitSet(req.query);
  const q = req.query.path;
  const pathFilter = typeof q === 'string' && q !== '' ? q : undefined;
  return commitSet === undefined && pathFilter === undefined ? {} : { path: pathFilter, commitSet };
}

function parseIntParam(req: Request, name: string, fallback: number): number {
  const raw = req.query[name];
  if (typeof raw !== 'string' || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 100000) {
    throw new HttpError(400, `Invalid ${name}: ${raw}`);
  }
  return n;
}

export function createApiRouter(): express.Router {
  const router = express.Router();

  // Uploads land in a temp dir under the data dir before ingestion.
  const uploadsDir = path.join(getDataDir(), 'uploads');
  const ensureUploadsDir: express.RequestHandler = async (_req, _res, next) => {
    await fs.mkdir(uploadsDir, { recursive: true });
    next();
  };
  const upload = multer({
    dest: uploadsDir,
    limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // generous: repos can be large
  });

  router.get('/repos', async (_req, res, next) => {
    try {
      res.json(await listRepos());
    } catch (err) {
      next(err);
    }
  });

  router.post('/repos/url', express.json(), async (req, res, next) => {
    try {
      const url = typeof req.body?.url === 'string' ? req.body.url : '';
      if (!url) throw new HttpError(400, 'Request body must include a "url" string.');
      res.status(201).json(await ingestUrl(url));
    } catch (err) {
      next(err);
    }
  });

  router.post('/repos/zip', ensureUploadsDir, upload.single('zip'), async (req, res, next) => {
    const file = req.file;
    try {
      if (!file) throw new HttpError(400, 'Upload a zip file under the "zip" multipart field.');
      const fallbackName =
        typeof req.body?.name === 'string' && req.body.name.trim() !== ''
          ? req.body.name.trim()
          : undefined;
      res.status(201).json(await ingestZip(file.path, fallbackName));
    } catch (err) {
      next(err);
    } finally {
      if (file) await fs.rm(file.path, { force: true }).catch(() => {});
    }
  });

  router.delete('/repos/:id', async (req, res, next) => {
    try {
      await deleteRepo(req.params.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // The repository page: repository metrics, top files by churn, author table.
  router.get('/repos/:id', async (req, res, next) => {
    try {
      const topFiles = parseIntParam(req, 'top', 25);
      res.json(await repoView(req.params.id, parseMetricsQuery(req), topFiles));
    } catch (err) {
      next(err);
    }
  });

  // Full file table (the drill-down UI in T2 adds directory browsing on top).
  router.get('/repos/:id/files', async (req, res, next) => {
    try {
      const { log } = await loadLog(req.params.id);
      const limit = parseIntParam(req, 'limit', 500);
      res.json(fileMetrics(log, parseMetricsQuery(req)).slice(0, limit));
    } catch (err) {
      next(err);
    }
  });

  router.get('/repos/:id/authors', async (req, res, next) => {
    try {
      const { log } = await loadLog(req.params.id);
      res.json(authorMetrics(log, parseMetricsQuery(req)));
    } catch (err) {
      next(err);
    }
  });

  // Commit list for the manual commit-set picker.
  router.get('/repos/:id/commits', async (req, res, next) => {
    try {
      res.json(await listCommits(req.params.id));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export function apiErrorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof RepoNotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof IngestError) {
    res.status(400).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}
