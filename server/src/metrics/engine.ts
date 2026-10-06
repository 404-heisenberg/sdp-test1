import type { Commit, Log, Row } from '../git/parseGitLog.js';

/** How the commit set H is selected. Default (omitted) is every commit. */
export type CommitSetSelection =
  | { kind: 'all' }
  /** Commits with committer date in [from, to) — ISO 8601 strings, either bound optional. */
  | { kind: 'range'; from?: string; to?: string }
  /** Explicitly listed commit hashes (non-merge commits reachable from HEAD only, by construction). */
  | { kind: 'list'; hashes: string[] };

export interface MetricsQuery {
  /** File or directory path. '' or undefined = whole repository (root). Recursive below directories. */
  path?: string;
  /** Post-mailmap author email. Restricts H to that author's commits (case-insensitive). */
  author?: string;
  commitSet?: CommitSetSelection;
}

export interface PathMetrics {
  path: string; // '' = repository root
  added: number; // l+
  removed: number; // l−
  growth: number; // δ = l+ − l−
  churn: number; // λ = l+ + l−
  modifications: number; // n: commits in H that changed this path
  commitSetSize: number; // |H|
  modificationFrequency: number; // η = n/|H| (0 when |H| = 0)
  churnRate: number; // ρ = λ/|H| (0 when |H| = 0)
}

export interface AuthorMetrics {
  email: string; // post-mailmap identity key
  name: string;
  modifications: number; // n_a: commits in H by this author that changed the path
  churn: number; // λ_a
  ownership: number; // ω = λ_a/λ (0 when λ = 0)
}

function selectCommits(log: Log, sel: CommitSetSelection, author?: string): Commit[] {
  let selected: Commit[];
  if (sel.kind === 'all') {
    selected = log.commits;
  } else if (sel.kind === 'range') {
    // Compare instants, not raw strings: %cI dates can carry mixed UTC offsets.
    const from = sel.from === undefined ? undefined : Date.parse(sel.from);
    const to = sel.to === undefined ? undefined : Date.parse(sel.to);
    selected = log.commits.filter((c) => {
      const t = Date.parse(c.date);
      return (from === undefined || t >= from) && (to === undefined || t < to);
    });
  } else {
    const wanted = new Set(sel.hashes);
    selected = log.commits.filter((c) => wanted.has(c.hash));
  }
  if (author === undefined) return selected;
  const want = author.toLowerCase();
  return selected.filter((c) => c.authorEmail.toLowerCase() === want);
}

/** A row lies under a path when it is that file or lives anywhere below the directory. */
export function underPath(rowPath: string, path: string): boolean {
  if (path === '') return true;
  return rowPath === path || rowPath.startsWith(path + '/');
}

function normalizePath(path: string | undefined): string {
  let p = (path ?? '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (p === '.' || p === '/') p = '';
  return p;
}

/** A modification is a commit in H with λ > 0 on the path (pure renames don't count). */
function touched(added: number, removed: number): boolean {
  return added + removed > 0;
}

export function pathMetrics(log: Log, query: MetricsQuery = {}): PathMetrics {
  const commits = selectCommits(log, query.commitSet ?? { kind: 'all' }, query.author);
  const inSet = new Set(commits.map((c) => c.hash));
  const path = normalizePath(query.path);

  let added = 0;
  let removed = 0;
  const modifyingCommits = new Set<string>();
  for (const row of log.rows) {
    if (!inSet.has(row.hash)) continue;
    if (!underPath(row.path, path)) continue;
    added += row.added;
    removed += row.removed;
    if (touched(row.added, row.removed)) modifyingCommits.add(row.hash);
  }

  const churn = added + removed;
  const h = commits.length;
  const n = modifyingCommits.size;
  return {
    path,
    added,
    removed,
    growth: added - removed,
    churn,
    modifications: n,
    commitSetSize: h,
    modificationFrequency: h === 0 ? 0 : n / h,
    churnRate: h === 0 ? 0 : churn / h,
  };
}

export function fileMetrics(log: Log, query: MetricsQuery = {}): PathMetrics[] {
  const commits = selectCommits(log, query.commitSet ?? { kind: 'all' }, query.author);
  const inSet = new Set(commits.map((c) => c.hash));
  const scope = normalizePath(query.path);

  const perFile = new Map<string, { added: number; removed: number; mods: Set<string> }>();
  for (const row of log.rows) {
    if (!inSet.has(row.hash)) continue;
    if (!underPath(row.path, scope)) continue;
    let agg = perFile.get(row.path);
    if (!agg) {
      agg = { added: 0, removed: 0, mods: new Set<string>() };
      perFile.set(row.path, agg);
    }
    agg.added += row.added;
    agg.removed += row.removed;
    if (touched(row.added, row.removed)) agg.mods.add(row.hash);
  }

  const h = commits.length;
  return [...perFile.entries()]
    .map(([path, agg]) => {
      const churn = agg.added + agg.removed;
      const n = agg.mods.size;
      return {
        path,
        added: agg.added,
        removed: agg.removed,
        growth: agg.added - agg.removed,
        churn,
        modifications: n,
        commitSetSize: h,
        modificationFrequency: h === 0 ? 0 : n / h,
        churnRate: h === 0 ? 0 : churn / h,
      };
    })
    .sort((a, b) => b.churn - a.churn || a.path.localeCompare(b.path));
}

export type TreeEntry = PathMetrics & { kind: 'dir' | 'file' };

/** Immediate children (directories and files) of query.path, each with its recursive metrics. */
export function treeMetrics(log: Log, query: MetricsQuery = {}): TreeEntry[] {
  const commits = selectCommits(log, query.commitSet ?? { kind: 'all' }, query.author);
  const inSet = new Set(commits.map((c) => c.hash));
  const scope = normalizePath(query.path);

  const children = new Map<
    string,
    { kind: 'dir' | 'file'; added: number; removed: number; mods: Set<string> }
  >();
  for (const row of log.rows) {
    if (!inSet.has(row.hash)) continue;
    if (!underPath(row.path, scope)) continue;
    const rel = scope === '' ? row.path : row.path.slice(scope.length + 1);
    if (rel === '') continue; // a row on the scope path itself has no child here
    const slash = rel.indexOf('/');
    const name = slash === -1 ? rel : rel.slice(0, slash);
    const childPath = scope === '' ? name : `${scope}/${name}`;
    let agg = children.get(childPath);
    if (!agg) {
      agg = { kind: slash === -1 ? 'file' : 'dir', added: 0, removed: 0, mods: new Set<string>() };
      children.set(childPath, agg);
    }
    agg.added += row.added;
    agg.removed += row.removed;
    if (touched(row.added, row.removed)) agg.mods.add(row.hash);
  }

  const h = commits.length;
  return [...children.entries()]
    .map(([path, agg]) => {
      const churn = agg.added + agg.removed;
      const n = agg.mods.size;
      return {
        path,
        kind: agg.kind,
        added: agg.added,
        removed: agg.removed,
        growth: agg.added - agg.removed,
        churn,
        modifications: n,
        commitSetSize: h,
        modificationFrequency: h === 0 ? 0 : n / h,
        churnRate: h === 0 ? 0 : churn / h,
      };
    })
    .sort((a, b) => b.churn - a.churn || a.path.localeCompare(b.path));
}

export interface FileHistoryEntry {
  hash: string;
  authorName: string;
  date: string; // committer date, ISO 8601
  subject: string;
  added: number;
  removed: number;
}

/** Per-commit adds/removes for a path (file: exact; directory: sums below it), newest first. */
export function fileHistory(log: Log, query: MetricsQuery = {}): FileHistoryEntry[] {
  const commits = selectCommits(log, query.commitSet ?? { kind: 'all' }, query.author);
  const path = normalizePath(query.path);

  const rowsByHash = new Map<string, Row[]>();
  for (const row of log.rows) {
    if (!underPath(row.path, path)) continue;
    const list = rowsByHash.get(row.hash);
    if (list) list.push(row);
    else rowsByHash.set(row.hash, [row]);
  }

  const history: FileHistoryEntry[] = [];
  for (const commit of commits) {
    const rows = rowsByHash.get(commit.hash);
    if (!rows) continue;
    let added = 0;
    let removed = 0;
    for (const row of rows) {
      added += row.added;
      removed += row.removed;
    }
    history.push({
      hash: commit.hash,
      authorName: commit.authorName,
      date: commit.date,
      subject: commit.subject,
      added,
      removed,
    });
  }
  return history;
}

export function authorMetrics(log: Log, query: MetricsQuery = {}): AuthorMetrics[] {
  const commits = selectCommits(log, query.commitSet ?? { kind: 'all' }, query.author);
  const inSet = new Set(commits.map((c) => c.hash));
  const commitByHash = new Map(log.commits.map((c) => [c.hash, c]));
  const scope = normalizePath(query.path);

  let totalChurn = 0;
  const perAuthor = new Map<
    string,
    { name: string; nameDate: string; churn: number; mods: Set<string> }
  >();
  for (const row of log.rows) {
    if (!inSet.has(row.hash)) continue;
    if (!underPath(row.path, scope)) continue;
    const commit = commitByHash.get(row.hash);
    if (!commit) continue;
    const churn = row.added + row.removed;
    totalChurn += churn;
    let agg = perAuthor.get(commit.authorEmail);
    if (!agg) {
      agg = { name: commit.authorName, nameDate: commit.date, churn: 0, mods: new Set<string>() };
      perAuthor.set(commit.authorEmail, agg);
    }
    if (commit.date > agg.nameDate) {
      agg.name = commit.authorName;
      agg.nameDate = commit.date;
    }
    agg.churn += churn;
    if (touched(row.added, row.removed)) agg.mods.add(row.hash);
  }

  return [...perAuthor.entries()]
    .map(([email, agg]) => ({
      email,
      name: agg.name,
      modifications: agg.mods.size,
      churn: agg.churn,
      ownership: totalChurn === 0 ? 0 : agg.churn / totalChurn,
    }))
    .sort((a, b) => b.churn - a.churn || a.email.localeCompare(b.email));
}
