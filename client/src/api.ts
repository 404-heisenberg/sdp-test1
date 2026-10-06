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

export interface AuthorMerge {
  canonicalEmail: string;
  aliases: string[];
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

export interface TreeEntry extends PathMetrics {
  kind: 'dir' | 'file';
}

export interface TreeResponse {
  meta: { id: string; name: string; source: 'url' | 'zip'; origin?: string; ingestedAt: string };
  path: string;
  repository: PathMetrics;
  children: TreeEntry[];
}

export interface FileHistoryEntry {
  hash: string;
  authorName: string;
  date: string;
  subject: string;
  added: number;
  removed: number;
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

  repoTree: (id: string, params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request<TreeResponse>(`/api/repos/${encodeURIComponent(id)}/tree${qs ? `?${qs}` : ''}`);
  },

  repoAuthors: (id: string, params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request<AuthorMetrics[]>(`/api/repos/${encodeURIComponent(id)}/authors${qs ? `?${qs}` : ''}`);
  },

  listMerges: (id: string) =>
    request<{ merges: AuthorMerge[] }>(`/api/repos/${encodeURIComponent(id)}/authors/merges`),

  mergeAuthors: (id: string, canonicalEmail: string, aliasEmails: string[]) =>
    request<{ merges: AuthorMerge[] }>(`/api/repos/${encodeURIComponent(id)}/authors/merges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canonicalEmail, aliasEmails }),
    }),

  unmergeAuthors: (id: string, canonicalEmail: string) =>
    request<{ merges: AuthorMerge[] }>(
      `/api/repos/${encodeURIComponent(id)}/authors/merges/${encodeURIComponent(canonicalEmail)}`,
      { method: 'DELETE' },
    ),

  fileHistory: (id: string, params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request<FileHistoryEntry[]>(`/api/repos/${encodeURIComponent(id)}/history${qs ? `?${qs}` : ''}`);
  },
};
