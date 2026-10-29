export const PLANS = [
  { id: 120, name: 'Basic', amount: 120, label: '₹120' },
  { id: 500, name: 'Standard', amount: 500, label: '₹500' },
  { id: 1000, name: 'Premium', amount: 1000, label: '₹1000' }
];

export const PLAN_MAP = {
  120: { name: 'Basic', label: '₹120' },
  500: { name: 'Standard', label: '₹500' },
  1000: { name: 'Premium', label: '₹1000' }
};

// Legacy helper — prefer the StatusBadge component (components/StatusBadge.jsx),
// which is the single source of truth for status presentation.
export const STATUS_COLORS = {
  pending: 'badge-warning',
  manual_review: 'badge-review',
  pending_verification: 'badge-info',
  payment_pending: 'badge-warning',
  processing: 'badge-info',
  created: 'badge-info',
  verification_pending: 'badge-info',
  proof_submitted: 'badge-info',
  approved: 'badge-success',
  active: 'badge-success',
  completed: 'badge-success',
  rejected: 'badge-error',
  deleted: 'badge-error',
  suspended: 'badge-error',
  inactive: 'badge-neutral',
  disabled: 'badge-neutral',
};

export const ADMIN_UPI = 'jayarajj126-3@okicici';
