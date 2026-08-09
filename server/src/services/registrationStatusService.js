import { supabase } from '../db/supabase.js';

// Server-side registration/payment lifecycle states.
// The DATABASE is the single source of truth — derived from users.status
// combined with the user's latest payment row.
//
//   REGISTRATION_PENDING_PAYMENT -> users.status='pending', payments.status='pending'
//   PAYMENT_PENDING              -> users.status='pending', payments.status='pending'
//   PAYMENT_PROCESSING           -> users.status='pending', payments.status='processing'
//   PAYMENT_REJECTED             -> users.status='pending', payments.status='rejected'
//   PAYMENT_APPROVED             -> users.status='active',  payments.status='approved'
//   ACCOUNT_ACTIVE               -> users.status='active'
//   ACCOUNT_INACTIVE             -> users.status='inactive'
//   ACCOUNT_DELETED              -> users.status='deleted'

export async function getRegistrationState(userId) {
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, status, current_plan, referral_code, role')
    .eq('id', userId)
    .single();

  if (userError || !user) {
    return { user: null, registrationState: 'ACCOUNT_UNKNOWN', paymentStatus: null };
  }

  if (user.role === 'admin' || user.status === 'active') {
    return {
      user,
      registrationState: 'ACCOUNT_ACTIVE',
      paymentStatus: user.status === 'active' ? 'approved' : null,
      dashboardEnabled: true
    };
  }

  const { data: payment, error: paymentError } = await supabase
    .from('payments')
    .select('id, status, selected_plan, expected_amount, rejection_reason, submitted_at, verified_at, transaction_id, screenshot_url')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  const paymentStatus = paymentError || !payment ? null : payment.status;

  let registrationState;
  switch (user.status) {
    case 'deleted':
      registrationState = 'ACCOUNT_DELETED';
      break;
    case 'inactive':
    case 'suspended':
      registrationState = 'ACCOUNT_INACTIVE';
      break;
    case 'pending':
      registrationState = paymentStatus === 'rejected'
        ? 'PAYMENT_REJECTED'
        : paymentStatus === 'processing'
          ? 'PAYMENT_PROCESSING'
          : paymentStatus === 'approved'
            ? 'PAYMENT_APPROVED'
            : 'PAYMENT_PENDING';
      break;
    default:
      registrationState = 'REGISTRATION_PENDING_PAYMENT';
  }

  return {
    user,
    registrationState,
    paymentStatus,
    dashboardEnabled: user.status === 'active',
    payment: payment || null
  };
}

// Whether a user may access the normal user dashboard.
export function isDashboardAllowed(state) {
  if (!state || !state.user) return false;
  if (state.user.role === 'admin') return true;
  return state.user.status === 'active';
}
