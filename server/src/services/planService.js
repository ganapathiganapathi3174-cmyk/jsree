import { supabase } from '../db/supabase.js';
import { logAction } from './auditService.js';

const PLANS = [
  { id: '120', name: 'Basic', amount: 120, description: 'Basic membership plan' },
  { id: '500', name: 'Standard', amount: 500, description: 'Standard membership plan' },
  { id: '1000', name: 'Premium', amount: 1000, description: 'Premium membership plan' }
];

export function getPlans() { return PLANS; }

export async function requestPlanChange(userId, currentPlan, requestedPlan, reason) {
  const { data: user, error: userError } = await supabase.from('users').select('id, current_plan, status').eq('id', userId).single();
  if (userError || !user) throw { message: 'User not found', code: 'USER_NOT_FOUND' };
  if (user.status !== 'active') throw { message: 'Only active users can request plan changes', code: 'USER_NOT_ACTIVE' };
  if (parseInt(user.current_plan) === parseInt(requestedPlan)) throw { message: 'Requested plan is same as current plan', code: 'SAME_PLAN' };

  const { data: existingPending } = await supabase.from('plan_change_requests').select('id').eq('user_id', userId).eq('status', 'pending').single();
  if (existingPending) throw { message: 'You already have a pending plan change request', code: 'PENDING_EXISTS' };

  const planInfo = PLANS.find(p => p.id === String(requestedPlan));
  if (!planInfo) throw { message: 'Invalid plan selected', code: 'INVALID_PLAN' };

  const { data: request, error } = await supabase.from('plan_change_requests').insert({
    user_id: userId, current_plan: parseInt(currentPlan), requested_plan: parseInt(requestedPlan), reason: reason || '', status: 'pending'
  }).select('*').single();

  if (error) throw { message: 'Failed to create plan change request', code: 'REQUEST_FAILED' };
  await logAction(userId, 'user', 'request_plan_change', request.id, 'plan_change', { from: currentPlan, to: requestedPlan, reason });
  return request;
}

export async function approvePlanChange(requestId, adminId) {
  const { data: request, error: fetchError } = await supabase.from('plan_change_requests').select('*').eq('id', requestId).single();
  if (fetchError || !request) throw { message: 'Plan change request not found', code: 'REQUEST_NOT_FOUND' };
  if (request.status !== 'pending') throw { message: 'Request is not in pending status', code: 'NOT_PENDING' };

  const { error: updateError } = await supabase.from('plan_change_requests').update({
    status: 'approved', processed_at: new Date().toISOString()
  }).eq('id', requestId);
  if (updateError) throw { message: 'Failed to approve plan change', code: 'APPROVE_FAILED' };

  const { error: userError } = await supabase.from('users').update({ current_plan: request.requested_plan }).eq('id', request.user_id);
  if (userError) throw { message: 'Failed to update user plan', code: 'USER_UPDATE_FAILED' };

  await logAction(adminId, 'admin', 'approve_plan_change', requestId, 'plan_change', { userId: request.user_id, from: request.current_plan, to: request.requested_plan });
  return { message: 'Plan change approved', requestId };
}

export async function rejectPlanChange(requestId, adminId, reason) {
  const { data: request, error: fetchError } = await supabase.from('plan_change_requests').select('*').eq('id', requestId).single();
  if (fetchError || !request) throw { message: 'Plan change request not found', code: 'REQUEST_NOT_FOUND' };
  if (request.status !== 'pending') throw { message: 'Request is not in pending status', code: 'NOT_PENDING' };

  const { error } = await supabase.from('plan_change_requests').update({
    status: 'rejected', processed_at: new Date().toISOString(), admin_note: reason
  }).eq('id', requestId);
  if (error) throw { message: 'Failed to reject plan change', code: 'REJECT_FAILED' };

  await logAction(adminId, 'admin', 'reject_plan_change', requestId, 'plan_change', { userId: request.user_id, reason });
  return { message: 'Plan change rejected', requestId };
}

export async function getPlanChangeRequests(userId) {
  const { data: requests, error } = await supabase.from('plan_change_requests').select('*').eq('user_id', userId).order('created_at', { ascending: false });
  if (error) throw { message: 'Failed to fetch plan change requests', code: 'FETCH_FAILED' };
  return requests;
}

export async function getAllPlanChangeRequests() {
  const { data: requests, error } = await supabase.from('plan_change_requests')
    .select('*, user:users!plan_change_requests_user_id_fkey(id, full_name, email, mobile)')
    .order('created_at', { ascending: false });
  if (error) throw { message: 'Failed to fetch plan change requests', code: 'FETCH_FAILED' };
  return requests;
}
