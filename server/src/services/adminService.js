import { supabase } from '../db/supabase.js';
import { logAction } from './auditService.js';

export async function getDashboardStats() {
  const counts = await Promise.all([
    supabase.from('users').select('id', { count: 'exact', head: true }).neq('role', 'admin'),
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('status', 'active').neq('role', 'admin'),
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('status', 'inactive').neq('role', 'admin'),
    supabase.from('payments').select('id', { count: 'exact', head: true }),
    supabase.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
    supabase.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'rejected'),
    supabase.from('topups').select('id', { count: 'exact', head: true }),
    supabase.from('topups').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
    supabase.from('plan_change_requests').select('id', { count: 'exact', head: true }),
    supabase.from('plan_change_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('payments').select('expected_amount').eq('status', 'approved'),
    supabase.from('topups').select('amount').eq('status', 'completed')
  ]);

  const [{ count: totalUsers }, { count: activeUsers }, { count: pendingUsers }, { count: inactiveUsers },
    { count: totalPayments }, { count: pendingPayments }, { count: approvedPayments }, { count: rejectedPayments },
    { count: totalTopups }, { count: completedTopups }, { count: totalPlanChanges }, { count: pendingPlanChanges },
    { data: approvedPaymentAmounts }, { data: completedTopupAmounts }
  ] = counts;

  const registrationCollection = (approvedPaymentAmounts || []).reduce((sum, p) => sum + (p.expected_amount || 0), 0);
  const topupCollection = (completedTopupAmounts || []).reduce((sum, t) => sum + (t.amount || 0), 0);

  const { data: recentUsers } = await supabase.from('users')
    .select('id, full_name, email, status, current_plan, created_at')
    .neq('role', 'admin').order('created_at', { ascending: false }).limit(5);

  const { data: recentPayments } = await supabase.from('payments')
    .select('id, user_id, selected_plan, expected_amount, status, created_at')
    .order('created_at', { ascending: false }).limit(5);

  const { count: unreadChats } = await supabase.from('messages')
    .select('id', { count: 'exact', head: true }).eq('sender_role', 'user').is('read_at', null);

  return {
    totalUsers: totalUsers || 0, activeUsers: activeUsers || 0, pendingUsers: pendingUsers || 0, inactiveUsers: inactiveUsers || 0,
    totalPayments: totalPayments || 0, pendingPayments: pendingPayments || 0, approvedPayments: approvedPayments || 0, rejectedPayments: rejectedPayments || 0,
    totalTopups: totalTopups || 0, completedTopups: completedTopups || 0,
    pendingPlanChanges: pendingPlanChanges || 0,
    registrationCollection, topupCollection,
    unreadChats: unreadChats || 0,
    recentUsers: recentUsers || [], recentPayments: recentPayments || []
  };
}

export async function getAllUsers(filters = {}) {
  let query = supabase.from('users')
    .select('id, full_name, email, mobile, role, status, referral_code, current_plan, created_at')
    .neq('role', 'admin');

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.plan) query = query.eq('current_plan', parseInt(filters.plan));
  if (filters.search) query = query.or(`full_name.ilike.%${filters.search}%,email.ilike.%${filters.search}%,mobile.ilike.%${filters.search}%`);

  const order = filters.sortOrder === 'asc' ? true : false;
  query = query.order(filters.sortBy || 'created_at', { ascending: order });

  if (filters.page && filters.limit) {
    const offset = (filters.page - 1) * filters.limit;
    query = query.range(offset, offset + filters.limit - 1);
  }

  const { data: users, error } = await query;
  if (error) throw { message: 'Failed to fetch users', code: 'FETCH_FAILED' };

  let countQuery = supabase.from('users').select('id', { count: 'exact', head: true }).neq('role', 'admin');
  if (filters.status) countQuery = countQuery.eq('status', filters.status);
  if (filters.plan) countQuery = countQuery.eq('current_plan', parseInt(filters.plan));
  if (filters.search) countQuery = countQuery.or(`full_name.ilike.%${filters.search}%,email.ilike.%${filters.search}%,mobile.ilike.%${filters.search}%`);
  const { count } = await countQuery;

  return { users: users || [], total: count || 0, page: filters.page || 1, limit: filters.limit || 20 };
}

export async function getUserDetails(userId) {
  const { data: user, error } = await supabase.from('users')
    .select('id, full_name, email, mobile, role, status, referral_code, referred_by, current_plan, inactive_reason, inactive_since, created_at')
    .eq('id', userId).single();
  if (error || !user) throw { message: 'User not found', code: 'USER_NOT_FOUND' };

  const { data: payments } = await supabase.from('payments').select('id, selected_plan, expected_amount, status, created_at').eq('user_id', userId).order('created_at', { ascending: false });
  const { data: referrals } = await supabase.from('users').select('id, full_name, email, status, current_plan, created_at').eq('referred_by', userId);
  const { data: sentTopups } = await supabase.from('topups').select('id, receiver_id, amount, status, created_at').eq('sender_id', userId);
  const { data: receivedTopups } = await supabase.from('topups').select('id, sender_id, amount, status, created_at').eq('receiver_id', userId);
  const { data: planChanges } = await supabase.from('plan_change_requests').select('id, current_plan, requested_plan, status, created_at').eq('user_id', userId);

  return { ...user, payments: payments || [], referrals: referrals || [], sentTopups: sentTopups || [], receivedTopups: receivedTopups || [], planChanges: planChanges || [] };
}

export async function updateUserStatus(userId, status, reason) {
  const validStatuses = ['active', 'inactive', 'pending'];
  if (!validStatuses.includes(status)) throw { message: 'Invalid status', code: 'INVALID_STATUS' };

  const { data: user, error: fetchError } = await supabase.from('users').select('id, status').eq('id', userId).single();
  if (fetchError || !user) throw { message: 'User not found', code: 'USER_NOT_FOUND' };

  const updates = { status };
  if (status === 'inactive') {
    updates.inactive_reason = reason || 'Admin deactivation';
    updates.inactive_since = new Date().toISOString();
  } else {
    updates.inactive_reason = null;
    updates.inactive_since = null;
  }

  const { error } = await supabase.from('users').update(updates).eq('id', userId);
  if (error) throw { message: 'Failed to update user status', code: 'UPDATE_FAILED' };

  await logAction(null, 'admin', `update_user_status_${status}`, userId, 'user', { previousStatus: user.status, newStatus: status, reason });
  return { message: 'User status updated', userId, status };
}

export async function deleteUser(userId, softDelete = true) {
  const { data: user, error: fetchError } = await supabase.from('users').select('id, role').eq('id', userId).single();
  if (fetchError || !user) throw { message: 'User not found', code: 'USER_NOT_FOUND' };
  if (user.role === 'admin') throw { message: 'Cannot delete admin user', code: 'CANNOT_DELETE_ADMIN' };

  if (softDelete) {
    const { error } = await supabase.from('users').update({ status: 'deleted' }).eq('id', userId);
    if (error) throw { message: 'Failed to delete user', code: 'DELETE_FAILED' };
    await logAction(null, 'admin', 'soft_delete_user', userId, 'user', {});
    return { message: 'User soft deleted', userId };
  }

  const relatedTables = [
    { table: 'audit_logs', col: 'actor_id' },
    { table: 'messages', col: 'sender_id' },
    { table: 'conversations', col: 'user_id' },
    { table: 'notifications', col: 'user_id' },
    { table: 'wallet_transactions', col: 'user_id' },
    { table: 'ip_logs', col: 'user_id' },
    { table: 'suspicious_activity', col: 'user_id' },
    { table: 'plan_change_requests', col: 'user_id' },
    { table: 'topups', col: 'sender_id' },
    { table: 'topups', col: 'receiver_id' },
    { table: 'referrals', col: 'referrer_id' },
    { table: 'referrals', col: 'referred_user_id' },
    { table: 'payments', col: 'user_id' },
  ];

  for (const { table, col } of relatedTables) {
    await supabase.from(table).delete().eq(col, userId);
  }

  const { error } = await supabase.from('users').delete().eq('id', userId);
  if (error) throw { message: 'Failed to delete user', code: 'DELETE_FAILED' };
  await logAction(null, 'admin', 'hard_delete_user', userId, 'user', {});
  return { message: 'User permanently deleted', userId };
}

export async function getInactiveUsers() {
  const { data: users, error } = await supabase.from('users')
    .select('id, full_name, email, mobile, current_plan, inactive_reason, inactive_since, created_at')
    .eq('status', 'inactive').neq('role', 'admin').order('inactive_since', { ascending: false });
  if (error) throw { message: 'Failed to fetch inactive users', code: 'FETCH_FAILED' };
  return users;
}

export async function activateUser(userId) {
  const { data: user, error: fetchError } = await supabase.from('users').select('id, status').eq('id', userId).single();
  if (fetchError || !user) throw { message: 'User not found', code: 'USER_NOT_FOUND' };
  if (user.status === 'active') throw { message: 'User is already active', code: 'USER_ALREADY_ACTIVE' };

  const { error } = await supabase.from('users').update({ status: 'active', inactive_reason: null, inactive_since: null }).eq('id', userId);
  if (error) throw { message: 'Failed to activate user', code: 'ACTIVATE_FAILED' };
  await logAction(null, 'admin', 'activate_user', userId, 'user', { previousStatus: user.status });
  return { message: 'User activated successfully', userId };
}
