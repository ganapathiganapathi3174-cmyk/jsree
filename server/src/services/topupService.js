import { supabase } from '../db/supabase.js';
import { generateUniqueFilename } from '../utils/helpers.js';
import { logAction } from './auditService.js';
import { checkAndDeactivateReferrer } from './referralService.js';

export async function createTopup(senderId, receiverId, amount) {
  const planAmounts = { 120: 120, 500: 500, 1000: 1000 };
  if (!planAmounts[amount]) throw { message: 'Invalid amount', code: 'INVALID_AMOUNT' };

  const { data: existingTopup } = await supabase.from('topups').select('id')
    .eq('sender_id', senderId).eq('receiver_id', receiverId)
    .in('status', ['created', 'payment_pending', 'proof_submitted', 'verification_pending']).single();
  if (existingTopup) throw { message: 'A pending topup already exists for this receiver', code: 'TOPUP_EXISTS' };

  const { data: topup, error } = await supabase.from('topups').insert({
    sender_id: senderId, receiver_id: receiverId, amount, plan: amount, status: 'created'
  }).select('*').single();
  if (error) throw { message: 'Failed to create topup', code: 'TOPUP_CREATE_FAILED' };

  await logAction(senderId, 'user', 'create_topup', topup.id, 'topup', { receiverId, amount });
  return topup;
}

export async function submitTopupProof(topupId, file, userId) {
  const { data: topup, error: fetchError } = await supabase.from('topups').select('*').eq('id', topupId).single();
  if (fetchError || !topup) throw { message: 'Topup not found', code: 'TOPUP_NOT_FOUND' };
  if (topup.sender_id !== userId) throw { message: 'Unauthorized', code: 'UNAUTHORIZED' };
  if (topup.status !== 'created' && topup.status !== 'payment_pending') throw { message: 'Topup is not in a submittable status', code: 'TOPUP_NOT_SUBMITTABLE' };

  const filename = generateUniqueFilename(file.originalname);
  const filePath = `topups/${topupId}/${filename}`;

  const { error: uploadError } = await supabase.storage.from('payments').upload(filePath, file.buffer, { contentType: file.mimetype, upsert: false });
  if (uploadError) throw { message: 'Failed to upload proof', code: 'UPLOAD_FAILED' };

  const { data: urlData } = supabase.storage.from('payments').getPublicUrl(filePath);

  const { error: updateError } = await supabase.from('topups').update({
    screenshot_url: urlData.publicUrl, status: 'proof_submitted'
  }).eq('id', topupId);
  if (updateError) throw { message: 'Failed to update topup', code: 'UPDATE_FAILED' };

  await logAction(userId, 'user', 'submit_topup_proof', topupId, 'topup', { filename });
  return { message: 'Proof submitted successfully', topupId };
}

export async function verifyTopup(topupId, adminId, approved, reason) {
  const { data: topup, error: fetchError } = await supabase.from('topups').select('*').eq('id', topupId).single();
  if (fetchError || !topup) throw { message: 'Topup not found', code: 'TOPUP_NOT_FOUND' };
  if (topup.status !== 'proof_submitted' && topup.status !== 'verification_pending') throw { message: 'Topup is not in a verifiable status', code: 'TOPUP_NOT_VERIFIABLE' };

  if (approved) {
    const { error } = await supabase.from('topups').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', topupId);
    if (error) throw { message: 'Failed to verify topup', code: 'VERIFY_FAILED' };

    const { error: receiverError } = await supabase.from('users').update({
      status: 'inactive', inactive_reason: 'inactive_due_to_referral_condition', inactive_since: new Date().toISOString()
    }).eq('id', topup.receiver_id);
    if (receiverError) throw { message: 'Failed to update receiver status', code: 'RECEIVER_UPDATE_FAILED' };

    await logAction(adminId, 'admin', 'approve_topup', topupId, 'topup', { senderId: topup.sender_id, receiverId: topup.receiver_id, amount: topup.amount });
    return { message: 'Topup approved and completed', topupId };
  } else {
    const { error } = await supabase.from('topups').update({ status: 'rejected', rejection_reason: reason }).eq('id', topupId);
    if (error) throw { message: 'Failed to reject topup', code: 'REJECT_FAILED' };

    await logAction(adminId, 'admin', 'reject_topup', topupId, 'topup', { senderId: topup.sender_id, receiverId: topup.receiver_id, reason });
    return { message: 'Topup rejected', topupId };
  }
}

export async function completeTopup(topupId) {
  const { data: topup, error: fetchError } = await supabase.from('topups').select('*').eq('id', topupId).single();
  if (fetchError || !topup) throw { message: 'Topup not found', code: 'TOPUP_NOT_FOUND' };
  if (topup.status !== 'verification_pending') throw { message: 'Topup is not in verification pending status', code: 'TOPUP_NOT_PENDING' };

  const { error } = await supabase.from('topups').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', topupId);
  if (error) throw { message: 'Failed to complete topup', code: 'COMPLETE_FAILED' };

  const { error: receiverError } = await supabase.from('users').update({
    status: 'inactive', inactive_reason: 'inactive_due_to_referral_condition', inactive_since: new Date().toISOString()
  }).eq('id', topup.receiver_id);
  if (receiverError) throw { message: 'Failed to update receiver status', code: 'RECEIVER_UPDATE_FAILED' };

  await logAction(null, 'system', 'complete_topup', topupId, 'topup', { senderId: topup.sender_id, receiverId: topup.receiver_id });
  return { message: 'Topup completed', topupId };
}

export async function rejectTopup(topupId, reason, adminId) {
  const { data: topup, error: fetchError } = await supabase.from('topups').select('*').eq('id', topupId).single();
  if (fetchError || !topup) throw { message: 'Topup not found', code: 'TOPUP_NOT_FOUND' };

  const { error } = await supabase.from('topups').update({ status: 'rejected', rejection_reason: reason }).eq('id', topupId);
  if (error) throw { message: 'Failed to reject topup', code: 'REJECT_FAILED' };

  await logAction(adminId, 'admin', 'reject_topup', topupId, 'topup', { reason });
  return { message: 'Topup rejected', topupId };
}

export async function getTopupsForUser(userId) {
  const { data: sent, error: sentError } = await supabase.from('topups')
    .select('*, receiver:users!topups_receiver_id_fkey(id, full_name, email)').eq('sender_id', userId).order('created_at', { ascending: false });
  const { data: received, error: receivedError } = await supabase.from('topups')
    .select('*, sender:users!topups_sender_id_fkey(id, full_name, email)').eq('receiver_id', userId).order('created_at', { ascending: false });
  if (sentError || receivedError) throw { message: 'Failed to fetch topups', code: 'FETCH_FAILED' };
  return { sent: sent || [], received: received || [] };
}

export async function getTopupDetails(topupId) {
  const { data: topup, error } = await supabase.from('topups')
    .select('*, sender:users!topups_sender_id_fkey(id, full_name, email), receiver:users!topups_receiver_id_fkey(id, full_name, email)')
    .eq('id', topupId).single();
  if (error || !topup) throw { message: 'Topup not found', code: 'TOPUP_NOT_FOUND' };
  return topup;
}
