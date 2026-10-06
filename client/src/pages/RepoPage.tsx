import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import type { RepoView } from '../api.js';

function fmt(n: number, digits = 2): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="metric">
      <div className="label">{label}</div>
      <div className={`value${tone === 'pos' ? ' positive' : tone === 'neg' ? ' negative' : ''}`}>
        {value}
      </div>
    </div>
  );
}

export default function RepoPage() {
  const { id } = useParams<{ id: string }>();
  const [view, setView] = useState<RepoView | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    api
      .repoView(id, { top: '25' })
      .then(setView)
      .catch((err) => setError((err as Error).message));
  }, [id]);

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

  if (!view) {
    return (
      <div className="container">
        <Link className="back-link" to="/">
          ← All repositories
        </Link>
        <div className="empty">Loading…</div>
      </div>
    );
  }

  const r = view.repository;
  return (
    <div className="container">
      <Link className="back-link" to="/">
        ← All repositories
      </Link>
      <header className="app-header">
        <h1>{view.meta.name}</h1>
      </header>
      <p className="repo-meta">
        {view.meta.source === 'url' ? `Cloned from ${view.meta.origin ?? 'unknown'}` : 'Uploaded zip'} ·
        ingested {new Date(view.meta.ingestedAt).toLocaleString()} · {r.commitSetSize} non-merge commits
      </p>

      <div className="card">
        <h2>Repository metrics</h2>
        <div className="metric-grid">
          <Metric label="Added (l+)" value={fmt(r.added)} />
          <Metric label="Removed (l−)" value={fmt(r.removed)} />
          <Metric
            label="Growth (δ)"
            value={`${r.growth > 0 ? '+' : ''}${fmt(r.growth)}`}
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
        <h2>Top files by churn</h2>
        {view.files.length === 0 ? (
          <div className="empty">No file changes recorded.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>Added</th>
                <th>Removed</th>
                <th>Growth</th>
                <th>Churn</th>
                <th>Mods</th>
                <th>η</th>
                <th>ρ</th>
              </tr>
            </thead>
            <tbody>
              {view.files.map((f) => (
                <tr key={f.path}>
                  <td>{f.path}</td>
                  <td>{f.added}</td>
                  <td>{f.removed}</td>
                  <td className={f.growth > 0 ? 'positive' : f.growth < 0 ? 'negative' : ''}>
                    {f.growth > 0 ? '+' : ''}
                    {f.growth}
                  </td>
                  <td>{f.churn}</td>
                  <td>{f.modifications}</td>
                  <td>{fmt(f.modificationFrequency)}</td>
                  <td>{fmt(f.churnRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Authors</h2>
        {view.authors.length === 0 ? (
          <div className="empty">No authors recorded.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Author</th>
                <th>Modifications</th>
                <th>Churn (λa)</th>
                <th>Ownership (ω)</th>
              </tr>
            </thead>
            <tbody>
              {view.authors.map((a) => (
                <tr key={a.email}>
                  <td>
                    {a.name} <span className="subtitle">({a.email})</span>
                  </td>
                  <td>{a.modifications}</td>
                  <td>{a.churn}</td>
                  <td>{(a.ownership * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
