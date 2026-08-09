import { STATUS_COLORS } from '../utils/constants';

export default function StatusBadge({ status }) {
  const normalized = status?.toLowerCase() || '';
  const colorClass = STATUS_COLORS[normalized] || 'bg-gray-100 text-gray-800';
  const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClass}`}
    >
      {label}
    </span>
  );
}
