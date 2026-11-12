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
    .select('id, full_name, email, mobile, role, status, referral_code, referred_by, current_plan, created_at')
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

  const userIds = (users || []).map(u => u.id);
  let referralCounts = {};
  if (userIds.length > 0) {
    const { data: refRows } = await supabase.from('users')
      .select('referred_by').in('referred_by', userIds).not('referred_by', 'is', null);
    (refRows || []).forEach(r => { referralCounts[r.referred_by] = (referralCounts[r.referred_by] || 0) + 1; });
  }
  const usersWithCounts = (users || []).map(u => ({ ...u, referral_count: referralCounts[u.id] || 0 }));

  let countQuery = supabase.from('users').select('id', { count: 'exact', head: true }).neq('role', 'admin');
  if (filters.status) countQuery = countQuery.eq('status', filters.status);
  if (filters.plan) countQuery = countQuery.eq('current_plan', parseInt(filters.plan));
  if (filters.search) countQuery = countQuery.or(`full_name.ilike.%${filters.search}%,email.ilike.%${filters.search}%,mobile.ilike.%${filters.search}%`);
  const { count } = await countQuery;

  return { users: usersWithCounts, total: count || 0, page: filters.page || 1, limit: filters.limit || 20 };
}

export async function getUserDetails(userId) {
  const { data: user, error } = await supabase.from('users')
    .select('id, full_name, email, mobile, role, status, referral_code, referred_by, current_plan, wallet_balance, inactive_reason, inactive_since, created_at')
    .eq('id', userId).single();
  if (error || !user) throw { message: 'User not found', code: 'USER_NOT_FOUND' };

  let referredByUser = null;
  if (user.referred_by) {
    const { data: referrer } = await supabase.from('users')
      .select('id, full_name, email')
      .eq('id', user.referred_by).single();
    referredByUser = referrer || null;
  }

  const { data: payments } = await supabase.from('payments').select('id, selected_plan, expected_amount, status, transaction_id, rejection_reason, verification_result, created_at').eq('user_id', userId).order('created_at', { ascending: false });
  const { data: referrals } = await supabase.from('users').select('id, full_name, email, status, current_plan, created_at').eq('referred_by', userId);
  const { data: sentTopups } = await supabase.from('topups').select('id, receiver_id, amount, status, created_at').eq('sender_id', userId);
  const { data: receivedTopups } = await supabase.from('topups').select('id, sender_id, amount, status, created_at').eq('receiver_id', userId);
  const { data: planChanges } = await supabase.from('plan_change_requests').select('id, current_plan, requested_plan, status, created_at').eq('user_id', userId).order('created_at', { ascending: false });
  const { data: walletTransactions } = await supabase.from('wallet_transactions').select('id, type, amount, description, reference_type, balance_after, created_at').eq('user_id', userId).order('created_at', { ascending: false });
  const { data: notifications } = await supabase.from('notifications').select('id, type, title, read, created_at').eq('user_id', userId).order('created_at', { ascending: false });
  const { data: conversations } = await supabase.from('conversations').select('id, last_message_at, created_at').eq('user_id', userId);
  const { data: lastLoginRows } = await supabase.from('ip_logs').select('event_type, ip_address, created_at').eq('user_id', userId).eq('event_type', 'login').order('created_at', { ascending: false }).limit(1);

  let messageCount = 0;
  const conversationIds = (conversations || []).map(c => c.id);
  if (conversationIds.length > 0) {
    const { count } = await supabase.from('messages').select('id', { count: 'exact', head: true }).in('conversation_id', conversationIds);
    messageCount = count || 0;
  }

  return {
    ...user,
    referredByUser,
    payments: payments || [],
    referrals: referrals || [],
    sentTopups: sentTopups || [],
    receivedTopups: receivedTopups || [],
    planChanges: planChanges || [],
    walletTransactions: walletTransactions || [],
    notifications: notifications || [],
    conversations: conversations || [],
    messageCount,
    lastLogin: lastLoginRows?.[0] || null
  };
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

function rpcErrorCode(message = '') {
  if (message.includes('USER_NOT_FOUND')) return 'USER_NOT_FOUND';
  if (message.includes('CANNOT_DELETE_ADMIN')) return 'CANNOT_DELETE_ADMIN';
  if (message.includes('CANNOT_DELETE_SELF')) return 'CANNOT_DELETE_SELF';
  if (message.includes('ADMIN_REQUIRED')) return 'ADMIN_REQUIRED';
  return 'DELETE_FAILED';
}

function deletionErrorMessage(message = '') {
  const code = rpcErrorCode(message);
  if (code === 'USER_NOT_FOUND') return 'User not found';
  if (code === 'CANNOT_DELETE_ADMIN') return 'Cannot delete admin user';
  if (code === 'CANNOT_DELETE_SELF') return 'You cannot delete your own admin account';
  if (code === 'ADMIN_REQUIRED') return 'Admin access required';
  return 'Failed to delete user';
}

async function removeStorageObjects(paths = []) {
  if (!paths || paths.length === 0) return;
  try {
    await supabase.storage.from('payments').remove(paths);
  } catch (err) {
    console.error('Storage cleanup failed (non-blocking):', err.message);
  }
}

// Best-effort removal of every object inside one storage folder. Returns a
// warning instead of throwing: DB deletion has already committed at this
// point, so storage cleanup must never mask the deletion result.
async function emptyStorageFolder(bucket, folder) {
  try {
    const { data: files, error } = await supabase.storage.from(bucket).list(folder, { limit: 1000 });
    if (error) return { folder, removed: [], warning: `${bucket}/${folder}: ${error.message}` };
    const paths = (files || [])
      .filter(f => f?.name && !f.name.endsWith('/'))
      .map(f => `${folder}/${f.name}`);
    if (paths.length === 0) return { folder, removed: [], warning: null };
    const { error: removeError } = await supabase.storage.from(bucket).remove(paths);
    if (removeError) return { folder, removed: [], warning: `${bucket}/${folder}: ${removeError.message}` };
    return { folder, removed: paths, warning: null };
  } catch (err) {
    return { folder, removed: [], warning: `${bucket}/${folder}: ${err.message}` };
  }
}

// Removes every user-specific storage object: current screenshots (paths
// returned by the RPC), orphaned earlier uploads under payments/{paymentId}
// and topups/{topupId}, and anything under avatars/{userId}. Deduplicates
// against the RPC paths so nothing is counted or removed twice.
async function removeUserStorageObjects({ userId, paymentIds = [], topupIds = [], rpcPaths = [] }) {
  const warnings = [];
  const removed = new Set();

  for (const paymentId of paymentIds) {
    const r = await emptyStorageFolder('payments', `payments/${paymentId}`);
    r.removed.forEach(p => removed.add(p));
    if (r.warning) warnings.push(r.warning);
  }
  for (const topupId of topupIds) {
    const r = await emptyStorageFolder('payments', `topups/${topupId}`);
    r.removed.forEach(p => removed.add(p));
    if (r.warning) warnings.push(r.warning);
  }
  const avatar = await emptyStorageFolder('avatars', `avatars/${userId}`);
  avatar.removed.forEach(p => removed.add(p));
  if (avatar.warning) warnings.push(avatar.warning);

  const leftover = (rpcPaths || []).filter(p => !removed.has(p));
  if (leftover.length > 0) {
    try {
      const { error } = await supabase.storage.from('payments').remove(leftover);
      if (error) warnings.push(`payments: ${error.message}`);
      else leftover.forEach(p => removed.add(p));
    } catch (err) {
      warnings.push(`payments: ${err.message}`);
    }
  }

  return { status: warnings.length > 0 ? 'partial' : 'complete', removed: [...removed], warnings };
}

// Snapshot of the storage folders this user owns. Taken BEFORE the deletion
// RPC runs (the users row disappears inside that transaction). Failure here
// is non-fatal: the RPC still returns the current screenshot paths.
async function collectUserOwnedRefs(userId) {
  const [paymentsRes, topupsRes] = await Promise.all([
    supabase.from('payments').select('id').eq('user_id', userId),
    supabase.from('topups').select('id').or(`sender_id.eq.${userId},receiver_id.eq.${userId}`),
  ]).catch(() => [{ data: null }, { data: null }]);
  return {
    paymentIds: (paymentsRes?.data || []).map(r => r.id),
    topupIds: (topupsRes?.data || []).map(r => r.id),
  };
}

/**
 * COMPLETE user deletion (admin dashboard action).
 *
 * 1. Verifies the target exists, is not an admin (protected account) and is
 *    not the acting admin (self-delete guard).
 * 2. Snapshots the user's storage folders.
 * 3. Calls the admin_delete_user RPC — one SECURITY DEFINER transaction
 *    that archives financial records, deletes every associated row and
 *    writes the audit entry atomically (no partial deletion possible).
 * 4. Removes the user's storage objects best-effort AFTER the DB commit.
 *
 * Sessions/JWTs are invalidated implicitly: authentication re-reads the
 * users row on every request, and a missing row is rejected with 401.
 */
export async function deleteUser(userId, adminId = null) {
  const { data: user, error: fetchError } = await supabase
    .from('users').select('id, role, status, avatar_url').eq('id', userId).single();
  if (fetchError || !user) throw { message: 'User not found', code: 'USER_NOT_FOUND' };
  if (user.role === 'admin') throw { message: 'Cannot delete admin user', code: 'CANNOT_DELETE_ADMIN' };
  if (adminId && userId === adminId) throw { message: 'You cannot delete your own admin account', code: 'CANNOT_DELETE_SELF' };

  const ownedRefs = await collectUserOwnedRefs(userId);

  const { data, error: rpcError } = await supabase.rpc('admin_delete_user', {
    p_user_id: userId,
    p_admin_id: adminId,
  });
  if (rpcError) {
    throw { message: deletionErrorMessage(rpcError.message), code: rpcErrorCode(rpcError.message) };
  }

  const cleanup = await removeUserStorageObjects({
    userId,
    paymentIds: ownedRefs.paymentIds,
    topupIds: ownedRefs.topupIds,
    rpcPaths: data?.storagePaths || [],
  });

  await logAction(adminId, 'admin', 'hard_delete_user', userId, 'user', {
    deleted: true,
    archived: data?.archived || null,
    storageCleanup: cleanup.status,
    ...(cleanup.warnings.length ? { storageWarnings: cleanup.warnings } : {}),
  });

  return {
    message: cleanup.status === 'complete'
      ? 'User deleted permanently'
      : 'User deleted permanently (some storage files could not be removed)',
    userId,
    deleted: true,
    storageCleanup: cleanup.status,
    archived: data?.archived || null,
    warnings: cleanup.warnings,
  };
}

export async function deleteTopup(topupId, adminId) {
  const { data, error } = await supabase.rpc('admin_delete_topup', {
    p_topup_id: topupId,
    p_admin_id: adminId
  });
  if (error) throw { message: 'Failed to delete topup', code: rpcErrorCode(error.message) };

  await removeStorageObjects(data?.storagePaths);
  if (data?.alreadyDeleted) return { message: 'Top-up already deleted', alreadyDeleted: true, topupId };
  return { message: 'Top-up deleted successfully', topupId };
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
