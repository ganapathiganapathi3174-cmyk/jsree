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

export const STATUS_COLORS = {
  pending: { badge: 'bg-warning-50 text-warning-700 border border-warning-200', dot: 'bg-warning-600' },
  manual_review: { badge: 'bg-warning-50 text-warning-700 border border-warning-200', dot: 'bg-warning-600' },
  payment_pending: { badge: 'bg-warning-50 text-warning-700 border border-warning-200', dot: 'bg-warning-600' },
  processing: { badge: 'bg-info-50 text-info-700 border border-info-200', dot: 'bg-info-600' },
  created: { badge: 'bg-info-50 text-info-700 border border-info-200', dot: 'bg-info-600' },
  verification_pending: { badge: 'bg-info-50 text-info-700 border border-info-200', dot: 'bg-info-600' },
  proof_submitted: { badge: 'bg-info-50 text-info-700 border border-info-200', dot: 'bg-info-600' },
  approved: { badge: 'bg-success-50 text-success-700 border border-success-200', dot: 'bg-success-600' },
  active: { badge: 'bg-success-50 text-success-700 border border-success-200', dot: 'bg-success-600' },
  completed: { badge: 'bg-success-50 text-success-700 border border-success-200', dot: 'bg-success-600' },
  rejected: { badge: 'bg-error-50 text-error-700 border border-error-200', dot: 'bg-error-600' },
  deleted: { badge: 'bg-error-50 text-error-700 border border-error-200', dot: 'bg-error-600' },
  suspended: { badge: 'bg-orange-50 text-orange-700 border border-orange-200', dot: 'bg-orange-600' },
  inactive: { badge: 'bg-gray-100 text-gray-600 border border-gray-200', dot: 'bg-gray-400' },
  disabled: { badge: 'bg-gray-100 text-gray-600 border border-gray-200', dot: 'bg-gray-400' },
};

export const ADMIN_UPI = 'jayarajj126-3@okicici';
