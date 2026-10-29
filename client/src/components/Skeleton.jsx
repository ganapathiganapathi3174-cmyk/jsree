export default function Skeleton({ className = '', count = 1 }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={`skeleton ${className}`}
          style={{ height: className.includes('h-') ? undefined : '20px' }}
        />
      ))}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="card space-y-4">
      <div className="skeleton h-4 w-1/3" />
      <div className="skeleton h-8 w-1/2" />
      <div className="skeleton h-3 w-2/3" />
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 4 }) {
  return (
    <div className="table-shell">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className={`flex gap-4 px-4 py-3.5 ${r > 0 ? 'border-t border-line/70' : ''}`}>
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className="skeleton flex-1 h-4" />
          ))}
        </div>
      ))}
    </div>
  );
}
