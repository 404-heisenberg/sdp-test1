import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import type { AuthorMetrics, FileHistoryEntry, RepoView } from '../api.js';
import Breadcrumb from '../components/Breadcrumb.js';
import { filtersFromParams, filtersToParams } from '../components/FilterBar.js';
import Metric from '../components/Metric.js';
import MetricsTable from '../components/MetricsTable.js';
import type { Column } from '../components/MetricsTable.js';
import { fmt, fmtDate, fmtPercent, fmtSigned } from '../format.js';

function basename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

const historyColumns: Column<FileHistoryEntry>[] = [
  { key: 'date', label: 'Date', render: (h) => fmtDate(h.date) },
  { key: 'authorName', label: 'Author' },
  { key: 'subject', label: 'Subject' },
  { key: 'added', label: 'Added', numeric: true },
  { key: 'removed', label: 'Removed', numeric: true },
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

export default function FilePage() {
  const { id } = useParams<{ id: string }>();
  const path = useParams<{ '*': string }>()['*'] ?? '';
  const [searchParams] = useSearchParams();
  const filterParams = filtersToParams(filtersFromParams(searchParams));
  const [view, setView] = useState<RepoView | null>(null);
  const [history, setHistory] = useState<FileHistoryEntry[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    let alive = true;
    const params: Record<string, string> = { path, ...filterParams };
    Promise.all([api.repoView(id, params), api.fileHistory(id, params)])
      .then(([v, h]) => {
        if (alive) {
          setView(v);
          setHistory(h);
          setError('');
        }
      })
      .catch((err) => {
        if (alive) setError((err as Error).message);
      });
    return () => {
      alive = false;
    };
  }, [id, path, filterParams]);

  if (error) {
    return (
      <div className="container">
        <Link className="back-link" to={id ? `/repos/${encodeURIComponent(id)}` : '/'}>
          ← Back to repository
        </Link>
        <div className="message error">{error}</div>
      </div>
    );
  }

  if (!view || !history) {
    return (
      <div className="container">
        <Link className="back-link" to={id ? `/repos/${encodeURIComponent(id)}` : '/'}>
          ← Back to repository
        </Link>
        <div className="empty">Loading…</div>
      </div>
    );
  }

  const f = view.repository;
  return (
    <div className="container">
      <Link className="back-link" to="/">
        ← All repositories
      </Link>
      <Breadcrumb id={view.meta.id} name={view.meta.name} path={path} params={filterParams} />

      <div className="card">
        <h2>File metrics</h2>
        <div className="metric-grid">
          <Metric label="Added (l+)" value={fmt(f.added)} />
          <Metric label="Removed (l−)" value={fmt(f.removed)} />
          <Metric
            label="Growth (δ)"
            value={fmtSigned(f.growth)}
            tone={f.growth > 0 ? 'pos' : f.growth < 0 ? 'neg' : undefined}
          />
          <Metric label="Churn (λ)" value={fmt(f.churn)} />
          <Metric label="Modifications (n)" value={fmt(f.modifications)} />
          <Metric label="|H|" value={fmt(f.commitSetSize)} />
          <Metric label="Mod. frequency (η)" value={fmt(f.modificationFrequency)} />
          <Metric label="Churn rate (ρ)" value={fmt(f.churnRate)} />
        </div>
      </div>

      <div className="card">
        <h2>History — {basename(path)}</h2>
        <MetricsTable
          columns={historyColumns}
          rows={history}
          rowKey={(h) => h.hash}
          initialSort={{ key: 'date', dir: 'desc' }}
          searchValue={(h) => `${h.authorName} ${h.subject}`}
          searchPlaceholder="Search commits…"
          emptyMessage="No commits recorded for this file."
        />
      </div>

      <div className="card">
        <h2>Authors — {path}</h2>
        <MetricsTable
          columns={authorColumns}
          rows={view.authors}
          rowKey={(a) => a.email}
          initialSort={{ key: 'churn', dir: 'desc' }}
          searchValue={(a) => `${a.name} ${a.email}`}
          searchPlaceholder="Search authors…"
          emptyMessage="No authors recorded for this file."
        />
      </div>
    </div>
  );
}
