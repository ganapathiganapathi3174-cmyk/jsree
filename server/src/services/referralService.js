import { supabase } from '../db/supabase.js';
import { logAction } from './auditService.js';

export async function getMyReferralCode(userId) {
  const { data: user, error } = await supabase.from('users').select('id, referral_code, status').eq('id', userId).single();
  if (error || !user) throw { message: 'User not found', code: 'USER_NOT_FOUND' };
  return { referralCode: user.referral_code, status: user.status };
}

export async function getMyReferrals(userId) {
  const { data: referrals, error } = await supabase.from('users')
    .select('id, full_name, email, mobile, status, current_plan, created_at')
    .eq('referred_by', userId).order('created_at', { ascending: false });
  if (error) throw { message: 'Failed to fetch referrals', code: 'FETCH_FAILED' };

  const activeCount = referrals.filter(r => r.status === 'active').length;
  const pendingCount = referrals.filter(r => r.status === 'pending').length;
  return { referrals, stats: { total: referrals.length, active: activeCount, pending: pendingCount, canReferMore: activeCount < 2 } };
}

export async function validateReferralCode(code) {
  if (!code || typeof code !== 'string') return { valid: false, message: 'Referral code is required' };
  const { data: user, error } = await supabase.from('users').select('id, full_name, status').eq('referral_code', code.toUpperCase().trim()).single();
  if (error || !user) return { valid: false, message: 'Invalid referral code' };
  if (user.status === 'inactive' || user.status === 'deleted') return { valid: false, message: 'Referral code is no longer active' };
  return { valid: true, referrerName: user.full_name };
}

export async function checkAndDeactivateReferrer(userId) {
  const { data: user, error: userError } = await supabase.from('users').select('id, referral_code, status').eq('id', userId).single();
  if (userError || !user) throw { message: 'User not found', code: 'USER_NOT_FOUND' };
  if (user.status !== 'active') return { deactivated: false, reason: 'User is not active' };

  const { data: referrals, error: refError } = await supabase.from('users').select('id, status').eq('referred_by', userId);
  if (refError) throw { message: 'Failed to check referrals', code: 'CHECK_FAILED' };

  const approvedReferrals = referrals.filter(r => r.status === 'active');
  if (approvedReferrals.length >= 2) {
    const { error: deactivateError } = await supabase.from('users').update({
      status: 'inactive', inactive_reason: 'inactive_due_to_referral_condition', inactive_since: new Date().toISOString()
    }).eq('id', userId);
    if (deactivateError) throw { message: 'Failed to deactivate user', code: 'DEACTIVATE_FAILED' };

    await logAction(userId, 'system', 'auto_deactivate', userId, 'user', { reason: 'Maximum referrals reached', approvedCount: approvedReferrals.length });
    return { deactivated: true, reason: 'User deactivated due to having 2+ approved referrals', approvedCount: approvedReferrals.length };
  }
  return { deactivated: false, approvedCount: approvedReferrals.length, remaining: 2 - approvedReferrals.length };
}

export async function activateUser(userId) {
  const { data: user, error: fetchError } = await supabase.from('users').select('id, status').eq('id', userId).single();
  if (fetchError || !user) throw { message: 'User not found', code: 'USER_NOT_FOUND' };
  if (user.status === 'active') throw { message: 'User is already active', code: 'USER_ALREADY_ACTIVE' };

  const { error } = await supabase.from('users').update({ status: 'active', inactive_reason: null, inactive_since: null }).eq('id', userId);
  if (error) throw { message: 'Failed to activate user', code: 'ACTIVATE_FAILED' };
  await logAction(null, 'admin', 'activate_user', userId, 'user', { previousStatus: user.status });
  return { message: 'User activated successfully' };
}

export async function deactivateUser(userId, reason) {
  const { data: user, error: fetchError } = await supabase.from('users').select('id, status').eq('id', userId).single();
  if (fetchError || !user) throw { message: 'User not found', code: 'USER_NOT_FOUND' };
  if (user.status === 'inactive') throw { message: 'User is already inactive', code: 'USER_ALREADY_INACTIVE' };

  const { error } = await supabase.from('users').update({
    status: 'inactive', inactive_reason: reason || 'Admin deactivation', inactive_since: new Date().toISOString()
  }).eq('id', userId);
  if (error) throw { message: 'Failed to deactivate user', code: 'DEACTIVATE_FAILED' };
  await logAction(null, 'admin', 'deactivate_user', userId, 'user', { reason: reason || 'Admin deactivation' });
  return { message: 'User deactivated successfully' };
}
