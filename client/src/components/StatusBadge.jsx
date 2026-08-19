import { STATUS_COLORS } from '../utils/constants';

export default function StatusBadge({ status, size = 'md' }) {
  const normalized = status?.toLowerCase() || '';
  const color = STATUS_COLORS[normalized] || { badge: 'bg-gray-100 text-gray-600 border border-gray-200', dot: 'bg-gray-400' };
  const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
  const isSmall = size === 'sm';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium capitalize whitespace-nowrap ${color.badge} ${
        isSmall ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-0.5 text-xs'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${color.dot}`} />
      {label}
    </span>
  );
}