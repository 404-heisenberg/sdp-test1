import { randomUUID } from 'node:crypto';
import type { Ingested } from './ingest.js';

export type IngestStage = 'cloning' | 'extracting' | 'analyzing' | 'saving' | 'done' | 'error';

export interface IngestJob {
  jobId: string;
  stage: IngestStage;
  percent?: number; // cloning: receive percentage from git's progress line
  commits?: number; // analyzing: streamed counts
  rows?: number;
  result?: Ingested; // done
  error?: string; // error
}

// In-memory job registry: ingestion runs in the background and the client polls.
const jobs = new Map<string, IngestJob>();
const TTL_MS = 10 * 60_000; // finished jobs stay queryable for a while, then expire

function expire(id: string): void {
  setTimeout(() => jobs.delete(id), TTL_MS).unref();
}

export function createJob(stage: IngestStage): string {
  const id = randomUUID();
  jobs.set(id, { jobId: id, stage });
  return id;
}

export function getJob(id: string): IngestJob | undefined {
  return jobs.get(id);
}

export function updateJob(id: string, patch: Partial<IngestJob>): void {
  const job = jobs.get(id);
  if (job) Object.assign(job, patch);
}

export function finishJob(id: string, result: Ingested): void {
  updateJob(id, { stage: 'done', percent: 100, result, error: undefined });
  expire(id);
}

export function failJob(id: string, error: string): void {
  updateJob(id, { stage: 'error', error });
  expire(id);
}
