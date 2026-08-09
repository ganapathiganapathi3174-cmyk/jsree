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
  pending: 'bg-yellow-100 text-yellow-800',
  processing: 'bg-blue-100 text-blue-800',
  approved: 'bg-green-100 text-green-800',
  active: 'bg-green-100 text-green-800',
  completed: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  inactive: 'bg-gray-100 text-gray-800',
  suspended: 'bg-orange-100 text-orange-800',
  deleted: 'bg-red-100 text-red-800',
  created: 'bg-blue-100 text-blue-800',
  payment_pending: 'bg-yellow-100 text-yellow-800',
  proof_submitted: 'bg-purple-100 text-purple-800',
  verification_pending: 'bg-orange-100 text-orange-800',
  disabled: 'bg-gray-100 text-gray-800'
};

export const ADMIN_UPI = 'jayarajj126-3@okicici';
