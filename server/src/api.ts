import fs from 'node:fs/promises';
import path from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { ingestUrl, ingestZip, IngestError } from './ingest.js';
import type { IngestEvent } from './ingest.js';
import { createJob, getJob, finishJob, failJob, updateJob } from './progress.js';
import {
  listRepos,
  repoView,
  listCommits,
  deleteRepo,
  RepoNotFoundError,
  loadLog,
} from './registry.js';
import { getDataDir } from './paths.js';
import { loadMerges, saveMerge, deleteMerge, MergeError } from './merges.js';
import {
  pathMetrics,
  fileMetrics,
  authorMetrics,
  treeMetrics,
  fileHistory,
} from './metrics/engine.js';
import type { CommitSetSelection } from './metrics/engine.js';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Mirror an ingestion stage event into the job registry for client polling. */
function applyIngestEvent(jobId: string, event: IngestEvent): void {
  if (event.stage === 'cloning') {
    updateJob(jobId, { stage: 'cloning', percent: event.percent });
  } else if (event.stage === 'analyzing') {
    updateJob(jobId, { stage: 'analyzing', commits: event.commits, rows: event.rows });
  } else {
    updateJob(jobId, { stage: event.stage });
  }
}

/** Start ingestion in the background; the job id is the progress handle. */
function startIngest(
  jobId: string,
  run: (onEvent: (event: IngestEvent) => void) => Promise<{ id: string; name: string; source: 'url' | 'zip'; origin?: string }>,
): void {
  void run((event) => applyIngestEvent(jobId, event))
    .then((ingested) => finishJob(jobId, ingested))
    .catch((err: unknown) =>
      failJob(jobId, err instanceof Error ? err.message : 'Ingestion failed.'),
    );
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
  for (const [label, value] of [
    ['from', from],
    ['to', to],
  ] as const) {
    if (value !== undefined && Number.isNaN(Date.parse(value))) {
      throw new HttpError(400, `Invalid ${label} timestamp: ${value}`);
    }
  }
  return { kind: 'range', from, to };
}

function parseMetricsQuery(req: Request) {
  const commitSet = parseCommitSet(req.query);
  const q = req.query.path;
  const pathFilter = typeof q === 'string' && q !== '' ? q : undefined;
  const a = req.query.author;
  const author = typeof a === 'string' && a !== '' ? a : undefined;
  return commitSet === undefined && pathFilter === undefined && author === undefined
    ? {}
    : { path: pathFilter, commitSet, author };
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

  // Ingestion runs in the background; the client polls GET /ingest/:jobId.
  router.post('/repos/url', express.json(), async (req, res, next) => {
    try {
      const url = typeof req.body?.url === 'string' ? req.body.url : '';
      if (!url) throw new HttpError(400, 'Request body must include a "url" string.');
      const jobId = createJob('cloning');
      startIngest(jobId, (onEvent) => ingestUrl(url, onEvent));
      res.status(202).json({ jobId });
    } catch (err) {
      next(err);
    }
  });

  router.get('/ingest/:jobId', async (req, res, next) => {
    try {
      const job = getJob(req.params.jobId);
      if (!job) throw new HttpError(404, `Unknown ingest job: ${req.params.jobId}`);
      res.json(job);
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
      const jobId = createJob('extracting');
      const zipPath = file.path;
      startIngest(jobId, (onEvent) =>
        // The background job consumes the temp zip; drop it once that settles.
        ingestZip(zipPath, fallbackName, onEvent).finally(() =>
          fs.rm(zipPath, { force: true }).catch(() => {}),
        ),
      );
      res.status(202).json({ jobId });
    } catch (err) {
      next(err);
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

  // Directory browsing: metrics at the path plus its immediate children (dirs and files).
  router.get('/repos/:id/tree', async (req, res, next) => {
    try {
      const { meta, log } = await loadLog(req.params.id);
      const query = parseMetricsQuery(req);
      res.json({
        meta,
        path: query.path ?? '',
        repository: pathMetrics(log, query),
        children: treeMetrics(log, query),
      });
    } catch (err) {
      next(err);
    }
  });

  // Per-commit adds/removes for a file or directory (newest first).
  router.get('/repos/:id/history', async (req, res, next) => {
    try {
      const { log } = await loadLog(req.params.id);
      const limit = parseIntParam(req, 'limit', 500);
      res.json(fileHistory(log, parseMetricsQuery(req)).slice(0, limit));
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

  // Author metrics with manual merges applied (recomputed from stored rows).
  router.get('/repos/:id/authors', async (req, res, next) => {
    try {
      const { log } = await loadLog(req.params.id);
      const merges = await loadMerges(req.params.id);
      res.json(authorMetrics(log, parseMetricsQuery(req), merges));
    } catch (err) {
      next(err);
    }
  });

  // Manual author merges: list, create (canonical + aliases), undo.
  router.get('/repos/:id/authors/merges', async (req, res, next) => {
    try {
      res.json({ merges: await loadMerges(req.params.id) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/repos/:id/authors/merges', express.json(), async (req, res, next) => {
    try {
      const canonicalEmail = typeof req.body?.canonicalEmail === 'string' ? req.body.canonicalEmail : '';
      const aliasEmails = Array.isArray(req.body?.aliasEmails) ? req.body.aliasEmails : [];
      if (canonicalEmail === '' || aliasEmails.length === 0) {
        throw new HttpError(400, 'Body must include "canonicalEmail" (string) and "aliasEmails" (string[]).');
      }
      res.status(201).json({ merges: await saveMerge(req.params.id, canonicalEmail, aliasEmails) });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/repos/:id/authors/merges/:canonicalEmail', async (req, res, next) => {
    try {
      res.json({ merges: await deleteMerge(req.params.id, req.params.canonicalEmail) });
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
  if (err instanceof MergeError) {
    res.status(400).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}
