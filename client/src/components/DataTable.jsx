import EmptyState from './EmptyState';

function SkeletonRow({ columns }) {
  return (
    <tr className="animate-pulse">
      {columns.map((_, i) => (
        <td key={i} className="py-3 px-4">
          <div className="h-4 bg-gray-200 rounded w-3/4" />
        </td>
      ))}
    </tr>
  );
}

function SkeletonCard({ columns }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 animate-pulse">
      {columns.map((col, i) => (
        <div key={i} className="flex justify-between items-center py-2">
          <div className="h-3 bg-gray-200 rounded w-1/3" />
          <div className="h-4 bg-gray-200 rounded w-1/2" />
        </div>
      ))}
    </div>
  );
}

export default function DataTable({
  columns,
  data,
  onRowClick,
  emptyMessage = 'No records found',
  loading = false,
}) {
  if (loading) {
    return (
      <>
        <div className="hidden md:block table-shell overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/60">
                {columns.map((col, i) => (
                  <th
                    key={i}
                    className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider py-3 px-4"
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {[...Array(5)].map((_, i) => (
                <SkeletonRow key={i} columns={columns} />
              ))}
            </tbody>
          </table>
        </div>
        <div className="md:hidden space-y-3">
          {[...Array(3)].map((_, i) => (
            <SkeletonCard key={i} columns={columns} />
          ))}
        </div>
      </>
    );
  }

  if (!data || data.length === 0) {
    return <EmptyState title={emptyMessage} />;
  }

  return (
    <>
      <div className="hidden md:block table-shell overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/60">
              {columns.map((col, i) => (
                <th
                  key={i}
                  className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider py-3 px-4"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.map((row, rowIndex) => (
              <tr
                key={row._id || rowIndex}
                onClick={() => onRowClick && onRowClick(row)}
                className={`transition-colors ${
                  rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'
                } ${onRowClick ? 'cursor-pointer hover:bg-primary-50/60' : 'hover:bg-gray-50/60'}`}
              >
                {columns.map((col, colIndex) => (
                  <td
                    key={colIndex}
                    className="py-3 px-4 text-sm text-gray-700"
                  >
                    {col.render ? col.render(row) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="md:hidden space-y-3">
        {data.map((row, rowIndex) => (
          <div
            key={row._id || rowIndex}
            onClick={() => onRowClick && onRowClick(row)}
            className={`bg-white border border-gray-200 rounded-xl p-4 shadow-card ${
              onRowClick ? 'cursor-pointer active:bg-gray-50' : ''
            }`}
          >
            {columns.map((col, colIndex) => (
              <div
                key={colIndex}
                className="flex justify-between items-start py-1"
              >
                <span className="text-xs text-gray-500 font-medium">
                  {col.label}
                </span>
                <span className="text-sm text-gray-700 text-right ml-2">
                  {col.render ? col.render(row) : row[col.key] || 'N/A'}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}