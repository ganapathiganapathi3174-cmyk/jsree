export default function StatusBadge({ status, size = 'md', label: labelOverride, className = '' }) {
  const key = (status || '').toString().toLowerCase();
  const config = STATUS_BADGES[key] || STATUS_BADGES.neutral;
  const isSmall = size === 'sm';

  const label =
    labelOverride ||
    (status
      ? status
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase())
      : 'Unknown');

  return (
    <span
      className={`badge ${config.className} ${isSmall ? 'px-2 py-px text-[11px]' : ''} ${className}`}
      title={config.title || label}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}

// Single source of truth for every status presentation in the app.
// Colors are never the only signal — every badge carries a text label.
export const STATUS_BADGES = {
  // Payments / verification
  approved: { className: 'badge-success', dot: 'bg-success-500', title: 'Payment approved' },
  rejected: { className: 'badge-error', dot: 'bg-error-500', title: 'Payment rejected' },
  pending: { className: 'badge-warning', dot: 'bg-warning-500', title: 'Awaiting verification' },
  payment_pending: { className: 'badge-warning', dot: 'bg-warning-500', title: 'Awaiting payment' },
  pending_verification: { className: 'badge-info', dot: 'bg-info-500', title: 'Pending provider verification' },
  manual_review: { className: 'badge-review', dot: 'bg-accent-500', title: 'Queued for manual review' },
  processing: { className: 'badge-info', dot: 'bg-info-500', title: 'Processing' },
  verification_pending: { className: 'badge-info', dot: 'bg-info-500', title: 'Verification pending' },
  proof_submitted: { className: 'badge-info', dot: 'bg-info-500', title: 'Proof submitted' },
  created: { className: 'badge-info', dot: 'bg-info-500', title: 'Created' },
  // Accounts
  active: { className: 'badge-success', dot: 'bg-success-500', title: 'Active' },
  completed: { className: 'badge-success', dot: 'bg-success-500', title: 'Completed' },
  inactive: { className: 'badge-neutral', dot: 'bg-ink-faint', title: 'Inactive' },
  disabled: { className: 'badge-neutral', dot: 'bg-ink-faint', title: 'Disabled' },
  suspended: { className: 'badge-error', dot: 'bg-error-500', title: 'Suspended' },
  deleted: { className: 'badge-error', dot: 'bg-error-500', title: 'Deleted' },
  // Plan / requests
  pending_approval: { className: 'badge-warning', dot: 'bg-warning-500', title: 'Pending approval' },
  cancelled: { className: 'badge-neutral', dot: 'bg-ink-faint', title: 'Cancelled' },
  neutral: { className: 'badge-neutral', dot: 'bg-ink-faint', title: '' },
};
