import fs from 'node:fs/promises';
import path from 'node:path';
import { getReposDir } from './paths.js';
import { loadLog, RepoNotFoundError } from './registry.js';
import type { AuthorMerge } from './metrics/engine.js';

export type { AuthorMerge };

export class MergeError extends Error {}

/**
 * Per-repository manual author merges, persisted beside the row store as
 * rat-authors.json. Merges are stored state only — every metric is recomputed
 * from the stored rows at query time, so undoing a merge restores the prior
 * identities without touching git.
 */

function authorsFile(id: string): string {
  return path.join(getReposDir(), id, 'rat-authors.json');
}

async function readMerges(id: string): Promise<AuthorMerge[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(authorsFile(id), 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []; // no merges yet
    throw new MergeError(`Stored author merges for ${id} are unreadable.`);
  }
  if (!Array.isArray(raw) || raw.some((m) => !isMerge(m))) {
    throw new MergeError(`Stored author merges for ${id} are corrupt.`);
  }
  return raw as AuthorMerge[];
}

function isMerge(m: unknown): m is AuthorMerge {
  if (typeof m !== 'object' || m === null) return false;
  const x = m as { canonicalEmail?: unknown; aliases?: unknown };
  return (
    typeof x.canonicalEmail === 'string' &&
    Array.isArray(x.aliases) &&
    x.aliases.every((a) => typeof a === 'string')
  );
}

/** The stored merges for a repository (empty when none have been made). */
export async function loadMerges(id: string): Promise<AuthorMerge[]> {
  await loadLog(id); // RepoNotFoundError for unknown or unsafe ids
  return readMerges(id);
}

/**
 * Merge alias emails into a canonical author. Validates both sides against the
 * stored commits, appends to an existing entry for the same canonical, and
 * rejects overlapping merges (an alias that is another canonical or vice versa).
 */
export async function saveMerge(
  id: string,
  canonicalEmail: string,
  aliasEmails: string[],
): Promise<AuthorMerge[]> {
  const { log } = await loadLog(id);
  const known = new Set(log.commits.map((c) => c.authorEmail));
  const canonical = canonicalEmail.trim();
  if (canonical === '') throw new MergeError('Provide a canonical author email.');
  if (!known.has(canonical)) throw new MergeError(`Unknown author email: ${canonical}`);
  if (!Array.isArray(aliasEmails) || aliasEmails.length === 0) {
    throw new MergeError('Provide at least one alias email to merge.');
  }

  const merges = await readMerges(id);
  if (merges.some((m) => m.aliases.includes(canonical))) {
    throw new MergeError(`${canonical} is already merged into another author. Undo that merge first.`);
  }

  const existing = merges.find((m) => m.canonicalEmail === canonical);
  const aliasSet = new Set(existing?.aliases ?? []);
  const seenInCall = new Set<string>();
  for (const raw of aliasEmails) {
    const alias = typeof raw === 'string' ? raw.trim() : '';
    if (alias === '') throw new MergeError('Alias emails must not be empty.');
    if (alias === canonical) throw new MergeError('An author cannot be merged into itself.');
    if (!known.has(alias)) throw new MergeError(`Unknown author email: ${alias}`);
    if (seenInCall.has(alias)) throw new MergeError(`Duplicate alias email: ${alias}`);
    if (merges.some((m) => m.canonicalEmail === alias)) {
      throw new MergeError(`${alias} is already the canonical author of another merge. Undo that merge first.`);
    }
    seenInCall.add(alias);
    aliasSet.add(alias); // Set preserves insertion order; aliases already in the entry are a no-op
  }

  const entry: AuthorMerge = { canonicalEmail: canonical, aliases: [...aliasSet] };
  const next = existing
    ? merges.map((m) => (m === existing ? entry : m))
    : [...merges, entry];
  await fs.writeFile(authorsFile(id), JSON.stringify(next, null, 2));
  return next;
}

/** Undo a merge by its canonical email, restoring the prior identities. */
export async function deleteMerge(id: string, canonicalEmail: string): Promise<AuthorMerge[]> {
  await loadLog(id); // RepoNotFoundError for unknown or unsafe ids
  const merges = await readMerges(id);
  const next = merges.filter((m) => m.canonicalEmail !== canonicalEmail);
  if (next.length === merges.length) {
    throw new MergeError(`No stored merge for ${canonicalEmail}.`);
  }
  await fs.writeFile(authorsFile(id), JSON.stringify(next, null, 2));
  return next;
}
