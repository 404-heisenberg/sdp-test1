import { useEffect, useState } from 'react';
import { Link, useSearchParams, useParams } from 'react-router-dom';
import { api } from '../api.js';
import type { AuthorMetrics, TreeEntry, TreeResponse } from '../api.js';
import Breadcrumb, { browseUrl, fileUrl } from '../components/Breadcrumb.js';
import Metric from '../components/Metric.js';
import MetricsTable from '../components/MetricsTable.js';
import type { Column } from '../components/MetricsTable.js';
import { fmt, fmtPercent, fmtSigned } from '../format.js';

function basename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

const childColumns = (id: string): Column<TreeEntry>[] => [
  {
    key: 'path',
    label: 'Name',
    sortValue: (c) => basename(c.path),
    render: (c) => (
      <span className="tree-name">
        <span className={`kind-badge kind-${c.kind}`}>{c.kind === 'dir' ? 'DIR' : 'FILE'}</span>
        {c.kind === 'dir' ? (
          <Link to={browseUrl(id, c.path)}>{basename(c.path)}</Link>
        ) : (
          <Link to={fileUrl(id, c.path)}>{basename(c.path)}</Link>
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

const authorColumns: Column<AuthorMetrics>[] = [
  {
    key: 'name',
    label: 'Author',
    sortValue: (a) => a.name,
    render: (a) => (
      <>
        {a.name} <span className="subtitle">({a.email})</span>
      </>
    ),
  },
  { key: 'modifications', label: 'Modifications', numeric: true },
  { key: 'churn', label: 'Churn (λa)', numeric: true },
  { key: 'ownership', label: 'Ownership (ω)', numeric: true, render: (a) => fmtPercent(a.ownership) },
];

export default function RepoPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const path = searchParams.get('path') ?? '';
  const [tree, setTree] = useState<TreeResponse | null>(null);
  const [authors, setAuthors] = useState<AuthorMetrics[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    let alive = true;
    const params: Record<string, string> = path === '' ? {} : { path };
    Promise.all([api.repoTree(id, params), api.repoAuthors(id, params)])
      .then(([t, a]) => {
        if (alive) {
          setTree(t);
          setAuthors(a);
          setError('');
        }
      })
      .catch((err) => {
        if (alive) setError((err as Error).message);
      });
    return () => {
      alive = false;
    };
  }, [id, path]);

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
      <Breadcrumb id={tree.meta.id} name={tree.meta.name} path={tree.path} />
      <p className="repo-meta">
        {tree.meta.source === 'url' ? `Cloned from ${tree.meta.origin ?? 'unknown'}` : 'Uploaded zip'} · ingested{' '}
        {new Date(tree.meta.ingestedAt).toLocaleString()} · {r.commitSetSize} non-merge commits
      </p>

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
            columns={childColumns(id)}
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
          columns={authorColumns}
          rows={authors}
          rowKey={(a) => a.email}
          initialSort={{ key: 'churn', dir: 'desc' }}
          searchValue={(a) => `${a.name} ${a.email}`}
          searchPlaceholder="Search authors…"
          emptyMessage="No authors recorded."
        />
      </div>
    </div>
  );
}
