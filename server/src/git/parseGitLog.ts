export interface Commit {
  hash: string;
  authorName: string;
  authorEmail: string;
  date: string; // ISO 8601, committer date
  subject: string;
}

export interface Row {
  hash: string;
  path: string; // new path for renames
  added: number;
  removed: number;
}

export interface Log {
  commits: Commit[];
  rows: Row[];
}

// A parsed numstat path: rename lines use the NEW path, per spec.
export type ParsedNumstat = { path: string; added: number; removed: number };

export function parseNumstatLine(line: string): ParsedNumstat | null {
  const m = line.match(/^(\S+)\s+(\S+)\s+(.+)$/);
  if (!m) return null;
  const addedStr = m[1];
  const removedStr = m[2];
  // Binary files are marked with dashes — excluded from all line metrics.
  if (addedStr === '-' || removedStr === '-') return null;
  if (!/^\d+$/.test(addedStr) || !/^\d+$/.test(removedStr)) return null;
  const path = renameNewPath(m[3].trim());
  if (path === null) return null;
  return { path, added: Number(addedStr), removed: Number(removedStr) };
}

// Resolve a numstat path to its NEW path when the row is a rename.
// Git renders renames either as "old => new" or brace-compressed "src/{a.ts => b.ts}".
function renameNewPath(p: string): string | null {
  const brace = p.match(/^(.*)\{(.*)=>(.*)\}(.*)$/);
  if (brace) {
    const prefix = brace[1];
    const newInner = brace[3].trim();
    const suffix = brace[4];
    if (newInner === '') return null;
    return prefix + newInner + suffix;
  }
  const arrow = p.match(/^(.*?)\s*=>\s*(.*)$/);
  if (arrow) {
    const newPath = arrow[2].trim();
    if (newPath === '') return null;
    return newPath;
  }
  return p;
}
