import { Link } from 'react-router-dom';

/** In-repo URL for browsing a directory (`''` = repository root). */
export function browseUrl(id: string, path: string): string {
  return path === ''
    ? `/repos/${encodeURIComponent(id)}`
    : `/repos/${encodeURIComponent(id)}?path=${encodeURIComponent(path)}`;
}

/** In-repo URL for a file's detail view. */
export function fileUrl(id: string, path: string): string {
  return `/repos/${encodeURIComponent(id)}/file/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** `repo / dir / subdir` — every segment but the last links to its directory view. */
export default function Breadcrumb({ id, name, path }: { id: string; name: string; path: string }) {
  const segments = path === '' ? [] : path.split('/');
  return (
    <nav className="breadcrumb">
      <Link to={browseUrl(id, '')}>{name}</Link>
      {segments.map((segment, i) => {
        const target = segments.slice(0, i + 1).join('/');
        const current = i === segments.length - 1;
        return (
          <span key={target} className="crumb">
            <span className="crumb-sep">/</span>
            {current ? (
              <span className="crumb-current">{segment}</span>
            ) : (
              <Link to={browseUrl(id, target)}>{segment}</Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
