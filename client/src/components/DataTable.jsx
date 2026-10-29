import EmptyState from './EmptyState';

/**
 * DataTable — consistent responsive table.
 *
 * columns: [{ key, label, className?, render?(row, index)? }]
 * Desktop: scrollable table inside a panel.
 * Mobile:   stacked cards (no horizontal overflow).
 */
export default function DataTable({
  columns,
  data,
  onRowClick,
  emptyMessage = 'No records found',
  emptyIcon,
  emptyAction,
  loading = false,
  rowKey = (row, i) => row?.id ?? i,
}) {
  if (loading) {
    return (
      <div className="table-shell" aria-busy="true">
        {Array.from({ length: 5 }).map((_, r) => (
          <div key={r} className={`flex gap-4 px-4 py-4 ${r > 0 ? 'border-t border-line/70' : ''}`}>
            {columns.map((c, i) => (
              <div key={c.key} className={`skeleton h-4 ${i === 0 ? 'w-1/4' : 'flex-1'}`} />
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (!data?.length) {
    return (
      <div className="table-shell">
        <EmptyState
          icon={emptyIcon}
          title="No records found"
          description={emptyMessage}
          action={emptyAction}
        />
      </div>
    );
  }

  const CellValue = ({ col, row, index }) =>
    col.render ? col.render(row, index) : <span>{row[col.key]}</span>;

  return (
    <div className="table-shell">
      {/* Desktop / tablet */}
      <div className="hidden md:block table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} className={col.className || ''} scope="col">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr
                key={rowKey(row, i)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={onRowClick ? 'cursor-pointer' : ''}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === 'Enter') onRowClick(row);
                      }
                    : undefined
                }
              >
                {columns.map((col) => (
                  <td key={col.key} className={col.className || ''}>
                    <CellValue col={col} row={row} index={i} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: stacked cards */}
      <div className="md:hidden divide-y divide-line/70">
        {data.map((row, i) => (
          <div
            key={rowKey(row, i)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={`p-4 space-y-2 ${onRowClick ? 'cursor-pointer active:bg-surface-2/60' : ''}`}
          >
            {columns.map((col, ci) => (
              <div
                key={col.key}
                className={`flex items-start justify-between gap-3 ${
                  ci === 0 ? 'text-sm font-semibold text-ink' : 'text-xs'
                }`}
              >
                <span className="text-ink-faint uppercase tracking-wider font-medium shrink-0">
                  {col.label}
                </span>
                <span className="text-right text-ink-muted min-w-0 break-words">
                  <CellValue col={col} row={row} index={i} />
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
