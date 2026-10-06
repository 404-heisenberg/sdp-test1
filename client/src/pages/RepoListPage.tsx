import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import type { RepoSummary } from '../api.js';

export default function RepoListPage() {
  const [repos, setRepos] = useState<RepoSummary[] | null>(null);
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<'url' | 'zip' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setRepos(await api.listRepos());
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleUrl(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy('url');
    try {
      const added = await api.ingestUrl(url);
      setNotice(`Ingested ${added.name}.`);
      setUrl('');
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleZip(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    if (!file) {
      setError('Choose a zip file first.');
      return;
    }
    setBusy('zip');
    try {
      const added = await api.ingestZip(file);
      setNotice(`Ingested ${added.name}.`);
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Remove ${name} from RAT?`)) return;
    try {
      await api.deleteRepo(id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="container">
      <header className="app-header">
        <h1>RAT — Repo Analysis Tool</h1>
        <span>
          <Link to="/">Repositories</Link>
        </span>
      </header>

      <div className="ingest-forms">
        <form className="card ingest-form" onSubmit={handleUrl}>
          <h2>Ingest from URL</h2>
          <label htmlFor="repo-url">Git repository URL (cloned with full history)</label>
          <div className="row">
            <input
              id="repo-url"
              type="text"
              placeholder="https://github.com/user/repo.git"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <button type="submit" disabled={busy !== null}>
              {busy === 'url' ? 'Cloning…' : 'Clone & analyze'}
            </button>
          </div>
        </form>

        <form className="card ingest-form" onSubmit={handleZip}>
          <h2>Ingest from zip</h2>
          <label htmlFor="repo-zip">Zip containing the repo (with its .git directory)</label>
          <div className="row">
            <input
              id="repo-zip"
              type="file"
              accept=".zip"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <button type="submit" disabled={busy !== null}>
              {busy === 'zip' ? 'Analyzing…' : 'Upload & analyze'}
            </button>
          </div>
        </form>
      </div>

      {error && <div className="message error">{error}</div>}
      {notice && <div className="message info">{notice}</div>}

      <div className="card">
        <h2>Repositories</h2>
        {repos === null ? (
          <div className="empty">Loading…</div>
        ) : repos.length === 0 ? (
          <div className="empty">
            Nothing ingested yet — paste a URL or upload a zip above.
          </div>
        ) : (
          repos.map((r) => (
            <div className="repo-row" key={r.id}>
              <div>
                <div className="title">
                  <Link to={`/repos/${encodeURIComponent(r.id)}`}>{r.name}</Link>
                </div>
                <div className="subtitle">
                  {r.source === 'url' ? `cloned from ${r.origin ?? 'unknown'}` : 'uploaded zip'} ·{' '}
                  {new Date(r.ingestedAt).toLocaleString()}
                </div>
              </div>
              <div className="stats">
                {r.headMetrics.commitSetSize} commits · {r.headMetrics.churn} churn ·{' '}
                {r.headMetrics.growth > 0 ? '+' : ''}
                {r.headMetrics.growth} growth
              </div>
              <button className="ghost" onClick={() => handleDelete(r.id, r.name)}>
                Remove
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
