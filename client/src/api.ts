// Mirror of the server's API types (kept local so the client builds standalone).
export interface PathMetrics {
  path: string;
  added: number;
  removed: number;
  growth: number;
  churn: number;
  modifications: number;
  commitSetSize: number;
  modificationFrequency: number;
  churnRate: number;
}

export interface AuthorMetrics {
  email: string;
  name: string;
  modifications: number;
  churn: number;
  ownership: number;
}

export interface RepoSummary {
  id: string;
  name: string;
  source: 'url' | 'zip';
  origin?: string;
  ingestedAt: string;
  headMetrics: PathMetrics;
}

export interface RepoView {
  meta: { id: string; name: string; source: 'url' | 'zip'; origin?: string; ingestedAt: string };
  repository: PathMetrics;
  files: PathMetrics[];
  authors: AuthorMetrics[];
}

export interface CommitInfo {
  hash: string;
  authorName: string;
  date: string;
  subject: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body as T;
}

export const api = {
  listRepos: () => request<RepoSummary[]>('/api/repos'),

  ingestUrl: (url: string) =>
    request<RepoSummary>('/api/repos/url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    }),

  ingestZip: (file: File) => {
    const form = new FormData();
    form.append('zip', file);
    return request<RepoSummary>('/api/repos/zip', { method: 'POST', body: form });
  },

  deleteRepo: (id: string) => request<void>(`/api/repos/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  repoView: (id: string, params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request<RepoView>(`/api/repos/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`);
  },

  listCommits: (id: string) => request<CommitInfo[]>(`/api/repos/${encodeURIComponent(id)}/commits`),
};
