import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams, useParams } from 'react-router-dom';
import { api } from '../api.js';
import type { AuthorMerge, AuthorMetrics, TreeEntry, TreeResponse } from '../api.js';
import Breadcrumb, { browseUrl, fileUrl } from '../components/Breadcrumb.js';
import FilterBar from '../components/FilterBar.js';
import { filtersFromParams, filtersToParams } from '../components/FilterBar.js';
import type { FilterState } from '../components/FilterBar.js';
import Metric from '../components/Metric.js';
import MetricsTable from '../components/MetricsTable.js';
import type { Column } from '../components/MetricsTable.js';
import { fmt, fmtPercent, fmtSigned } from '../format.js';

function basename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

const childColumns = (id: string, filterParams: Record<string, string>): Column<TreeEntry>[] => [
  {
    key: 'path',
    label: 'Name',
    sortValue: (c) => basename(c.path),
    render: (c) => (
      <span className="tree-name">
        <span className={`kind-badge kind-${c.kind}`}>{c.kind === 'dir' ? 'DIR' : 'FILE'}</span>
        {c.kind === 'dir' ? (
          <Link to={browseUrl(id, c.path, filterParams)}>{basename(c.path)}</Link>
        ) : (
          <Link to={fileUrl(id, c.path, filterParams)}>{basename(c.path)}</Link>
        )}
      </span>
    ),
  },
  { key: 'added', label: 'Added', numeric: true },
  { key: 'removed', label: 'Removed', numeric: true },
  {
    key: 'growth',
    label: 'Growth',
    numeric: true,
    render: (c) => fmtSigned(c.growth),
    cellClass: (c) => (c.growth > 0 ? 'positive' : c.growth < 0 ? 'negative' : ''),
  },
  { key: 'churn', label: 'Churn', numeric: true },
  { key: 'modifications', label: 'Mods', numeric: true },
  {
    key: 'modificationFrequency',
    label: 'Mod. freq. (η)',
    numeric: true,
    render: (c) => fmt(c.modificationFrequency),
  },
  { key: 'churnRate', label: 'Churn rate (ρ)', numeric: true, render: (c) => fmt(c.churnRate) },
];

const authorColumns = (merges: AuthorMerge[]): Column<AuthorMetrics>[] => [
  {
    key: 'name',
    label: 'Author',
    sortValue: (a) => a.name,
    render: (a) => {
      const aliases = merges.find((m) => m.canonicalEmail === a.email)?.aliases ?? [];
      return (
        <>
          {a.name} <span className="subtitle">({a.email})</span>
          {aliases.length > 0 && (
            <span className="subtitle"> · merged: {aliases.join(', ')}</span>
          )}
        </>
      );
    },
  },
  { key: 'modifications', label: 'Modifications', numeric: true },
  { key: 'churn', label: 'Churn (λa)', numeric: true },
  { key: 'ownership', label: 'Ownership (ω)', numeric: true, render: (a) => fmtPercent(a.ownership) },
];

export default function RepoPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const path = searchParams.get('path') ?? '';
  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams]);
  const filterParams = useMemo(() => filtersToParams(filters), [filters]);
  // Dropdown options show every author within the path/commit-set scope,
  // independent of the author filter itself.
  const scopeParams = useMemo(() => filtersToParams({ ...filters, author: '' }), [filters]);
  const [tree, setTree] = useState<TreeResponse | null>(null);
  const [authors, setAuthors] = useState<AuthorMetrics[] | null>(null);
  const [scopeAuthors, setScopeAuthors] = useState<AuthorMetrics[]>([]);
  const [merges, setMerges] = useState<AuthorMerge[]>([]);
  const [mergeCanonical, setMergeCanonical] = useState('');
  const [mergeAlias, setMergeAlias] = useState('');
  const [mergeError, setMergeError] = useState('');
  const [mergeBusy, setMergeBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    let alive = true;
    const params: Record<string, string> = path === '' ? {} : { path };
    const withFilters = { ...params, ...filterParams };
    const scope = { ...params, ...scopeParams };
    Promise.all([api.repoTree(id, withFilters), api.repoAuthors(id, withFilters), api.repoAuthors(id, scope), api.listMerges(id)])
      .then(([t, a, sa, m]) => {
        if (alive) {
          setTree(t);
          setAuthors(a);
          setScopeAuthors(sa);
          setMerges(m.merges);
          setError('');
        }
      })
      .catch((err) => {
        if (alive) setError((err as Error).message);
      });
    return () => {
      alive = false;
    };
  }, [id, path, filterParams, scopeParams]);

  const applyFilters = (next: FilterState) => {
    const sp = new URLSearchParams();
    if (path) sp.set('path', path);
    for (const [k, v] of Object.entries(filtersToParams(next))) sp.set(k, v);
    setSearchParams(sp);
  };

  // Manual merges recompute author tables server-side from the stored rows;
  // only the authors list and merge state need refreshing afterwards.
  const refreshAuthors = (repoId: string) => {
    const params: Record<string, string> = path === '' ? {} : { path };
    const withFilters = { ...params, ...filterParams };
    Promise.all([api.repoAuthors(repoId, withFilters), api.listMerges(repoId)])
      .then(([a, m]) => {
        setAuthors(a);
        setMerges(m.merges);
      })
      .catch((err) => setMergeError((err as Error).message));
  };

  const doMerge = () => {
    if (!id || !mergeCanonical || !mergeAlias || mergeBusy) return;
    setMergeBusy(true);
    setMergeError('');
    api
      .mergeAuthors(id, mergeCanonical, [mergeAlias])
      .then((m) => {
        setMerges(m.merges);
        setMergeCanonical('');
        setMergeAlias('');
        refreshAuthors(id);
      })
      .catch((err) => setMergeError((err as Error).message))
      .finally(() => setMergeBusy(false));
  };

  const doUndo = (canonicalEmail: string) => {
    if (!id || mergeBusy) return;
    setMergeBusy(true);
    setMergeError('');
    api
      .unmergeAuthors(id, canonicalEmail)
      .then((m) => {
        setMerges(m.merges);
        refreshAuthors(id);
      })
      .catch((err) => setMergeError((err as Error).message))
      .finally(() => setMergeBusy(false));
  };

  if (error) {
    return (
      <div className="container">
        <Link className="back-link" to="/">
          ← All repositories
        </Link>
        <div className="message error">{error}</div>
      </div>
    );
  }

  if (!tree || !authors) {
    return (
      <div className="container">
        <Link className="back-link" to="/">
          ← All repositories
        </Link>
        <div className="empty">Loading…</div>
      </div>
    );
  }

  const r = tree.repository;
  return (
    <div className="container">
      <Link className="back-link" to="/">
        ← All repositories
      </Link>
      <Breadcrumb id={tree.meta.id} name={tree.meta.name} path={tree.path} params={filterParams} />
      <p className="repo-meta">
        {tree.meta.source === 'url' ? `Cloned from ${tree.meta.origin ?? 'unknown'}` : 'Uploaded zip'} · ingested{' '}
        {new Date(tree.meta.ingestedAt).toLocaleString()} · {r.commitSetSize} non-merge commits
      </p>

      {id && <FilterBar id={id} scopeAuthors={scopeAuthors} filters={filters} onChange={applyFilters} />}

      <div className="card">
        <h2>{tree.path === '' ? 'Repository metrics' : 'Directory metrics'}</h2>
        <div className="metric-grid">
          <Metric label="Added (l+)" value={fmt(r.added)} />
          <Metric label="Removed (l−)" value={fmt(r.removed)} />
          <Metric
            label="Growth (δ)"
            value={fmtSigned(r.growth)}
            tone={r.growth > 0 ? 'pos' : r.growth < 0 ? 'neg' : undefined}
          />
          <Metric label="Churn (λ)" value={fmt(r.churn)} />
          <Metric label="Modifications (n)" value={fmt(r.modifications)} />
          <Metric label="|H|" value={fmt(r.commitSetSize)} />
          <Metric label="Mod. frequency (η)" value={fmt(r.modificationFrequency)} />
          <Metric label="Churn rate (ρ)" value={fmt(r.churnRate)} />
        </div>
      </div>

      <div className="card">
        <h2>{tree.path === '' ? 'Contents' : 'Contents of ' + tree.path}</h2>
        {id && (
          <MetricsTable
            columns={childColumns(id, filterParams)}
            rows={tree.children}
            rowKey={(c) => c.path}
            initialSort={{ key: 'churn', dir: 'desc' }}
            searchValue={(c) => basename(c.path)}
            searchPlaceholder="Search files and directories…"
            emptyMessage="No changes recorded under this path."
          />
        )}
      </div>

      <div className="card">
        <h2>Authors{tree.path === '' ? '' : ` — ${tree.path}`}</h2>
        <MetricsTable
          columns={authorColumns(merges)}
          rows={authors}
          rowKey={(a) => a.email}
          initialSort={{ key: 'churn', dir: 'desc' }}
          searchValue={(a) => `${a.name} ${a.email}`}
          searchPlaceholder="Search authors…"
          emptyMessage="No authors recorded."
        />
        {id && scopeAuthors.length > 1 && (
          <div className="merge-controls">
            <strong>Merge authors</strong>
            <select
              value={mergeCanonical}
              onChange={(e) => setMergeCanonical(e.target.value)}
              aria-label="Canonical author"
            >
              <option value="">Keep as canonical…</option>
              {scopeAuthors.map((a) => (
                <option key={a.email} value={a.email}>
                  {a.name} ({a.email})
                </option>
              ))}
            </select>
            <span className="merge-arrow">←</span>
            <select
              value={mergeAlias}
              onChange={(e) => setMergeAlias(e.target.value)}
              aria-label="Alias author"
            >
              <option value="">Merge alias…</option>
              {scopeAuthors.map((a) => (
                <option key={a.email} value={a.email}>
                  {a.name} ({a.email})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={doMerge}
              disabled={!mergeCanonical || !mergeAlias || mergeCanonical === mergeAlias || mergeBusy}
            >
              {mergeBusy ? 'Working…' : 'Merge'}
            </button>
          </div>
        )}
        {merges.length > 0 && (
          <ul className="merge-list">
            {merges.map((m) => (
              <li key={m.canonicalEmail}>
                <span>
                  {m.aliases.join(', ')} → <strong>{m.canonicalEmail}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => doUndo(m.canonicalEmail)}
                  disabled={mergeBusy}
                  aria-label={`Undo merge into ${m.canonicalEmail}`}
                >
                  Undo
                </button>
              </li>
            ))}
          </ul>
        )}
        {mergeError && <div className="message error">{mergeError}</div>}
      </div>
    </div>
  );
}
