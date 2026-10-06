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

export interface LogCounts {
  commits: number;
  rows: number;
}

/**
 * Incremental builder for the row store, fed raw git output in arbitrary chunks.
 * The streamed and batch parses share this accumulator, so both paths have
 * identical semantics and huge logs never require one giant string in memory.
 */
export function createLogAccumulator() {
  const commits: Commit[] = [];
  const rows: Row[] = [];
  let currentHash: string | null = null;
  let carry = ''; // partial line carried between chunks

  const handleLine = (rawLine: string): void => {
    const line = rawLine.replace(/\r$/, '');
    if (line === '') return;
    if (line.includes('\x1f')) {
      const parts = line.split('\x1f');
      if (parts.length >= 5) {
        currentHash = parts[0];
        commits.push({
          hash: parts[0],
          authorName: parts[1],
          authorEmail: parts[2],
          date: parts[3],
          subject: parts[4],
        });
        return;
      }
    }
    const row = parseNumstatLine(line);
    if (row && currentHash !== null) {
      rows.push({ hash: currentHash, ...row });
    }
  };

  return {
    /** Feed the next chunk of raw output (any split point, newlines or not). */
    push(chunk: string): void {
      carry += chunk;
      let idx: number;
      while ((idx = carry.indexOf('\n')) !== -1) {
        handleLine(carry.slice(0, idx));
        carry = carry.slice(idx + 1);
      }
    },
    /** Flush a trailing partial line at end of stream. */
    end(): void {
      if (carry !== '') handleLine(carry);
      carry = '';
    },
    counts(): LogCounts {
      return { commits: commits.length, rows: rows.length };
    },
    result(): Log {
      this.end();
      return { commits, rows };
    },
  };
}
