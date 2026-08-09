import { useTheme } from '../contexts/ThemeContext';

export default function Skeleton({ className = '', count = 1 }) {
  const { dark } = useTheme();

  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={`rounded-lg animate-pulse ${dark ? 'bg-gray-700' : 'bg-gray-200'} ${className}`}
          style={{ height: className.includes('h-') ? undefined : '20px' }}
        />
      ))}
    </div>
  );
}

export function CardSkeleton() {
  const { dark } = useTheme();
  return (
    <div className={`rounded-xl p-6 space-y-4 ${dark ? 'bg-gray-800' : 'bg-white border border-gray-200'}`}>
      <div className={`h-4 w-1/3 rounded ${dark ? 'bg-gray-700' : 'bg-gray-200'} animate-pulse`} />
      <div className={`h-8 w-1/2 rounded ${dark ? 'bg-gray-700' : 'bg-gray-200'} animate-pulse`} />
      <div className={`h-3 w-2/3 rounded ${dark ? 'bg-gray-700' : 'bg-gray-200'} animate-pulse`} />
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 4 }) {
  const { dark } = useTheme();
  return (
    <div className={`rounded-xl overflow-hidden ${dark ? 'bg-gray-800' : 'bg-white border border-gray-200'}`}>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className={`flex gap-4 px-4 py-3 ${r > 0 ? `border-t ${dark ? 'border-gray-700' : 'border-gray-100'}` : ''}`}>
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className={`flex-1 h-4 rounded ${dark ? 'bg-gray-700' : 'bg-gray-200'} animate-pulse`} />
          ))}
        </div>
      ))}
    </div>
  );
}
