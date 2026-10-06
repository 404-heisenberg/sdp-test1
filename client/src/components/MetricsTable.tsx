import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export interface Column<Row> {
  key: string;
  label: string;
  /** Numeric columns sort by value and default to descending on first click. */
  numeric?: boolean;
  /** What to sort by; defaults to the row's value at `key`. */
  sortValue?: (row: Row) => string | number;
  /** Cell content; defaults to the row's value at `key`. */
  render?: (row: Row) => ReactNode;
  /** Extra class for the cell (e.g. growth tone). */
  cellClass?: (row: Row) => string;
}

interface MetricsTableProps<Row> {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  /** What the search box matches (case-insensitive substring); defaults to the first column. */
  searchValue?: (row: Row) => string;
  searchPlaceholder?: string;
  emptyMessage?: string;
}

/** A sortable, searchable table over metric rows. Every header sorts; the search box filters. */
export default function MetricsTable<Row>({
  columns,
  rows,
  rowKey,
  initialSort,
  searchValue,
  searchPlaceholder = 'Search…',
  emptyMessage = 'Nothing to show.',
}: MetricsTableProps<Row>) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>(
    initialSort ?? { key: columns[0].key, dir: 'asc' },
  );
  const [search, setSearch] = useState('');

  const sortColumn = columns.find((c) => c.key === sort.key) ?? columns[0];
  const firstColumn = columns[0];
  const valueOf = (row: Row): string | number =>
    sortColumn.sortValue ? sortColumn.sortValue(row) : (row as Record<string, unknown>)[sortColumn.key] as string | number;

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const text =
      searchValue ??
      ((row: Row) =>
        String(
          firstColumn.sortValue ? firstColumn.sortValue(row) : (row as Record<string, unknown>)[firstColumn.key] ?? '',
        ));
    const filtered = needle === '' ? rows : rows.filter((row) => text(row).toLowerCase().includes(needle));
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = valueOf(a);
      const vb = valueOf(b);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [rows, search, sort, columns, searchValue, firstColumn]);

  function toggleSort(column: Column<Row>) {
    setSort((prev) =>
      prev.key === column.key
        ? { key: column.key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key: column.key, dir: column.numeric ? 'desc' : 'asc' },
    );
  }

  return (
    <div className="metrics-table">
      <div className="table-toolbar">
        <input
          type="text"
          className="table-search"
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="table-count">
          {visible.length} of {rows.length}
        </span>
      </div>
      {visible.length === 0 ? (
        <div className="empty">{rows.length === 0 ? emptyMessage : 'No matches.'}</div>
      ) : (
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.numeric ? 'numeric' : ''}>
                  <button
                    type="button"
                    className={`sort${sort.key === c.key ? ` active-${sort.dir}` : ''}`}
                    onClick={() => toggleSort(c)}
                  >
                    {c.label}
                    <span className="arrow">{sort.key === c.key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((c) => (
                  <td key={c.key} className={`${c.numeric ? 'numeric' : ''} ${c.cellClass?.(row) ?? ''}`}>
                    {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
