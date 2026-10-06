import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import type { AuthorMetrics, CommitInfo } from '../api.js';

/** The analyst-facing filter state, kept in the URL so views are shareable. */
export interface FilterState {
  author: string; // post-mailmap email; '' = all authors
  from: string; // yyyy-mm-dd (inclusive), '' = unbounded
  to: string; // yyyy-mm-dd (inclusive), '' = unbounded
  hashes: string[]; // manual commit list; non-empty switches to picker mode
}

export const EMPTY_FILTERS: FilterState = { author: '', from: '', to: '', hashes: [] };

/** Convert the day-based `to` bound into the exclusive instant the API expects. */
function exclusiveTo(day: string): string {
  const end = new Date(`${day}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return end.toISOString().slice(0, 19);
}

/** Inverse of exclusiveTo: recover the inclusive day from the stored bound (all-UTC math). */
function inclusiveDay(iso: string): string {
  const day = iso.slice(0, 10);
  const end = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(end.getTime())) return '';
  end.setUTCDate(end.getUTCDate() - 1);
  return end.toISOString().slice(0, 10);
}

/** URLSearchParams -> FilterState (tolerates absent/garbled values). */
export function filtersFromParams(sp: URLSearchParams): FilterState {
  const hashesRaw = sp.get('hashes') ?? '';
  return {
    author: sp.get('author') ?? '',
    from: sp.get('from')?.slice(0, 10) ?? '',
    to: sp.get('to') ? inclusiveDay(sp.get('to')!) : '',
    hashes: hashesRaw ? hashesRaw.split(',').filter(Boolean) : [],
  };
}

/** FilterState -> query params for the API (date bounds as ISO instants). */
export function filtersToParams(f: FilterState): Record<string, string> {
  const p: Record<string, string> = {};
  if (f.author) p.author = f.author;
  if (f.from) p.from = `${f.from}T00:00:00`;
  if (f.to) p.to = exclusiveTo(f.to);
  if (f.hashes.length > 0) p.hashes = f.hashes.join(',');
  return p;
}

/** True when anything restricts the default commit set / author scope. */
export function hasActiveFilters(f: FilterState): boolean {
  return f.author !== '' || f.from !== '' || f.to !== '' || f.hashes.length > 0;
}

type Mode = 'all' | 'range' | 'pick';

function modeOf(f: FilterState): Mode {
  if (f.hashes.length > 0) return 'pick';
  if (f.from !== '' || f.to !== '') return 'range';
  return 'all';
}

export default function FilterBar({
  id,
  scopeAuthors,
  filters,
  onChange,
}: {
  id: string;
  /** Authors within the current path/commit-set scope (dropdown options). */
  scopeAuthors: AuthorMetrics[];
  filters: FilterState;
  onChange: (next: FilterState) => void;
}) {
  const mode = modeOf(filters);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [commits, setCommits] = useState<CommitInfo[] | null>(null);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Set<string>>(() => new Set(filters.hashes));

  // Load the commit list lazily, the first time the picker opens.
  useEffect(() => {
    if (!pickerOpen || commits) return;
    let alive = true;
    api
      .listCommits(id)
      .then((c) => {
        if (alive) setCommits(c);
      })
      .catch(() => {
        if (alive) setCommits([]);
      });
    return () => {
      alive = false;
    };
  }, [pickerOpen, id, commits]);

  useEffect(() => {
    setPicked(new Set(filters.hashes));
  }, [filters.hashes]);

  const shown = useMemo(() => {
    if (!commits) return [];
    const q = search.trim().toLowerCase();
    if (!q) return commits;
    return commits.filter((c) => `${c.subject} ${c.authorName} ${c.hash}`.toLowerCase().includes(q));
  }, [commits, search]);

  const setMode = (next: Mode) => {
    if (next === 'all') {
      onChange({ ...filters, from: '', to: '', hashes: [] });
      setPickerOpen(false);
    } else if (next === 'range') {
      onChange({ ...filters, hashes: [] });
      setPickerOpen(false);
    } else {
      setPickerOpen(true);
    }
  };

  const toggle = (hash: string) => {
    const next = new Set(picked);
    if (next.has(hash)) next.delete(hash);
    else next.add(hash);
    setPicked(next);
  };

  return (
    <div className="card filter-card">
      <h2>Filters</h2>
      <div className="filter-bar">
        <label>
          Commit set
          <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            <option value="all">All commits</option>
            <option value="range">Date range</option>
            <option value="pick">Picked commits{filters.hashes.length > 0 ? ` (${filters.hashes.length})` : ''}</option>
          </select>
        </label>

        {mode === 'range' && (
          <>
            <label>
              From
              <input
                type="date"
                value={filters.from}
                onChange={(e) => onChange({ ...filters, from: e.target.value, hashes: [] })}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={filters.to}
                onChange={(e) => onChange({ ...filters, to: e.target.value, hashes: [] })}
              />
            </label>
          </>
        )}

        <label>
          Author
          <select value={filters.author} onChange={(e) => onChange({ ...filters, author: e.target.value })}>
            <option value="">All authors</option>
            {scopeAuthors.map((a) => (
              <option key={a.email} value={a.email}>
                {a.name} ({a.email})
              </option>
            ))}
          </select>
        </label>

        {hasActiveFilters(filters) && (
          <button className="ghost" onClick={() => onChange({ ...EMPTY_FILTERS })}>
            Clear filters
          </button>
        )}
      </div>

      {pickerOpen && (
        <div className="commit-picker">
          <div className="picker-toolbar">
            <input
              type="text"
              placeholder="Filter commits by subject, author or hash…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span className="table-count">
              {picked.size} selected
            </span>
            <button
              onClick={() => {
                onChange({ ...filters, hashes: [...picked].sort(), from: '', to: '' });
                setPickerOpen(false);
              }}
            >
              Apply selection
            </button>
            <button
              className="ghost"
              onClick={() => {
                onChange({ ...filters, hashes: [] });
                setPicked(new Set());
                setPickerOpen(false);
              }}
            >
              Clear selection
            </button>
          </div>
          {commits === null ? (
            <div className="empty">Loading commits…</div>
          ) : (
            <ul className="picker-list">
              {shown.map((c) => (
                <li key={c.hash}>
                  <label>
                    <input
                      type="checkbox"
                      checked={picked.has(c.hash)}
                      onChange={() => toggle(c.hash)}
                    />
                    <span className="picker-date">{c.date.slice(0, 10)}</span>
                    <span className="picker-subject" title={c.subject}>
                      {c.subject}
                    </span>
                    <span className="picker-author">{c.authorName}</span>
                  </label>
                </li>
              ))}
              {shown.length === 0 && <li className="empty">No commits match.</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
