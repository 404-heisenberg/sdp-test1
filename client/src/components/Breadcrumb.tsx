import { Link } from 'react-router-dom';

/** In-repo URL for browsing a directory (`''` = repository root). Extra params carry active filters. */
export function browseUrl(id: string, path: string, params: Record<string, string> = {}): string {
  const search = new URLSearchParams({ ...(path === '' ? {} : { path }), ...params }).toString();
  return `/repos/${encodeURIComponent(id)}${search ? `?${search}` : ''}`;
}

/** In-repo URL for a file's detail view. */
export function fileUrl(id: string, path: string, params: Record<string, string> = {}): string {
  const search = new URLSearchParams(params).toString();
  const file = `/repos/${encodeURIComponent(id)}/file/${path.split('/').map(encodeURIComponent).join('/')}`;
  return `${file}${search ? `?${search}` : ''}`;
}

/** `repo / dir / subdir` — every segment but the last links to its directory view. */
export default function Breadcrumb({
  id,
  name,
  path,
  params = {},
}: {
  id: string;
  name: string;
  path: string;
  params?: Record<string, string>;
}) {
  const segments = path === '' ? [] : path.split('/');
  return (
    <nav className="breadcrumb">
      <Link to={browseUrl(id, '', params)}>{name}</Link>
      {segments.map((segment, i) => {
        const target = segments.slice(0, i + 1).join('/');
        const current = i === segments.length - 1;
        return (
          <span key={target} className="crumb">
            <span className="crumb-sep">/</span>
            {current ? (
              <span className="crumb-current">{segment}</span>
            ) : (
              <Link to={browseUrl(id, target, params)}>{segment}</Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
