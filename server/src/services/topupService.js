import { supabase } from '../db/supabase.js';
import { generateUniqueFilename } from '../utils/helpers.js';
import { logAction } from './auditService.js';
import { checkAndDeactivateReferrer } from './referralService.js';
import walletService from './walletService.js';
import { runScreenshotVerification, reserveApprovedUtr } from './verificationService.js';

const RECEIVER_UPI = process.env.ADMIN_UPI_ID || 'jayarajj126-3@okicici';
const SUBMITTABLE_STATUSES = ['created', 'payment_pending'];
const PLAN_AMOUNTS = { 120: 120, 500: 500, 1000: 1000 };
export const TOPUP_RECEIVED_REQUIRED = 2;

export async function createTopup(senderId, receiverId, amount) {
  if (!PLAN_AMOUNTS[amount]) throw { message: 'Invalid amount', code: 'INVALID_AMOUNT' };

  // Enforce: top-up amount must match the sender's current active plan.
  const { data: sender } = await supabase.from('users').select('current_plan').eq('id', senderId).single();
  if (!sender) throw { message: 'Sender not found', code: 'SENDER_NOT_FOUND' };
  const senderPlan = Number(sender.current_plan);
  if (senderPlan && Number(amount) !== senderPlan) {
    throw { message: 'Top-up amount must match your current plan', code: 'INVALID_AMOUNT' };
  }

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
  if (!SUBMITTABLE_STATUSES.includes(topup.status)) throw { message: 'Topup is not in a submittable status', code: 'TOPUP_NOT_SUBMITTABLE' };

  return uploadAndVerifyTopupProof(topup, file, userId);
}

// Direct sponsor top-up: the user can top-up their sponsor WITHOUT any
// pre-existing sponsor-created request. The sender resolves their sponsor
// (or uses an explicit receiverId), the top-up record is created on the fly
// and the payment screenshot is verified immediately with the same OCR
// engine used everywhere. No screenshot -> a 'created' record is returned so
// proof can be attached later through the normal pending flow.
//
// The record guards stay untouched: only one submittable top-up can exist per
// (sender, receiver) pair, approval credits the balance exactly once, and a
// UTR that was already approved elsewhere still rejects (DUPLICATE_UTR).
export async function createDirectTopup({ senderId, amount, receiverId, file }) {
  if (!PLAN_AMOUNTS[amount]) throw { message: 'Invalid amount', code: 'INVALID_AMOUNT' };

  // Enforce: top-up amount must match the sender's current active plan.
  const { data: sender } = await supabase.from('users').select('id, referred_by, current_plan').eq('id', senderId).single();
  if (!sender) throw { message: 'Sender not found', code: 'SENDER_NOT_FOUND' };
  const senderPlan = Number(sender.current_plan);
  if (senderPlan && Number(amount) !== senderPlan) {
    throw { message: 'Top-up amount must match your current plan', code: 'INVALID_AMOUNT' };
  }

  let targetReceiverId = receiverId || null;
  if (!targetReceiverId) {
    if (!sender.referred_by) throw { message: 'No sponsor found to top-up', code: 'NO_SPONSOR' };
    targetReceiverId = sender.referred_by;
  }

  const { data: receiver } = await supabase.from('users').select('id, full_name, status').eq('id', targetReceiverId).single();
  if (!receiver) throw { message: 'Receiver not found', code: 'RECEIVER_NOT_FOUND' };
  if (receiver.status === 'inactive' || receiver.status === 'deleted') throw { message: 'Receiver is not active', code: 'RECEIVER_INACTIVE' };

  // Reuse an already-pending top-up to this receiver instead of blocking with
  // TOPUP_EXISTS or creating a duplicate row. The user can therefore act the
  // moment they pay — no sponsor-created request was ever needed.
  const { data: existing } = await supabase.from('topups').select('*')
    .eq('sender_id', senderId).eq('receiver_id', targetReceiverId)
    .in('status', SUBMITTABLE_STATUSES).single();
  const topup = existing || (await createTopup(senderId, targetReceiverId, amount));

  if (!file) {
    return { message: 'Top-up created. Upload a payment screenshot to complete verification.', topupId: topup.id, created: true, credited: false };
  }
  return uploadAndVerifyTopupProof(topup, file, senderId);
}

// Check if a user has completed their own required top-up (at least one
// completed outgoing top-up to their sponsor). This determines claim eligibility.
export async function checkHasCompletedOwnTopup(userId) {
  const { data, error } = await supabase.from('topups')
    .select('id')
    .eq('sender_id', userId)
    .eq('status', 'completed')
    .limit(1);
  if (error) throw { message: 'Failed to check own top-up status', code: 'CHECK_FAILED' };
  return (data && data.length > 0);
}

// Claim a pending received top-up.
// Since top-ups are now completed immediately on verification (matching
// registration payment pattern), this endpoint handles already-completed
// topups idempotently.
export async function claimTopupForReceiver(topupId, userId) {
  const { data: topup, error: fetchError } = await supabase.from('topups').select('*').eq('id', topupId).single();
  if (fetchError || !topup) throw { message: 'Topup not found', code: 'TOPUP_NOT_FOUND' };

  if (topup.receiver_id !== userId) throw { message: 'Unauthorized', code: 'UNAUTHORIZED' };

  if (topup.status === 'completed') {
    return { message: 'Topup already completed', credited: false, alreadyClaimed: true };
  }

  throw { message: 'Topup is not in a claimable status', code: 'NOT_CLAIMABLE' };
}

// Pure summary of the received-top-up rule. Counts:
//   - receivedCompletedCount: completed received top-ups
// At TOPUP_RECEIVED_REQUIRED completed received top-ups the user MUST top-up.
export async function computeTopupSummary(receivedTopups, userId) {
  const completedCount = (receivedTopups || []).filter(t => t.status === 'completed').length;

  return {
    receivedCompletedCount: completedCount,
    receivedPendingCount: 0,
    receivedClaimableCount: 0,
    receivedRequired: TOPUP_RECEIVED_REQUIRED,
    remaining: Math.max(0, TOPUP_RECEIVED_REQUIRED - completedCount),
    mustTopup: completedCount >= TOPUP_RECEIVED_REQUIRED,
    canClaim: false,
  };
}

// Shared OCR verification pipeline used by the pending-proof flow and the
// direct sponsor top-up flow (identical behavior, no duplicated logic).
async function uploadAndVerifyTopupProof(topup, file, userId) {
  const topupId = topup.id;
  const filename = generateUniqueFilename(file.originalname);
  const filePath = `topups/${topupId}/${filename}`;

  const { error: uploadError } = await supabase.storage.from('payments').upload(filePath, file.buffer, { contentType: file.mimetype, upsert: false });
  if (uploadError) throw { message: 'Failed to upload proof', code: 'UPLOAD_FAILED' };

  const { data: urlData } = supabase.storage.from('payments').getPublicUrl(filePath);
  const screenshotUrl = urlData.publicUrl;

  const { error: saveError } = await supabase.from('topups').update({ screenshot_url: screenshotUrl }).eq('id', topupId);
  if (saveError) throw { message: 'Failed to update topup', code: 'UPDATE_FAILED' };

  // Same OCR verification engine as registration payments.
  // Final rule: approved = upiMatch && dateValid (+ OCR confidence gate).
  // Amount is NOT part of that decision. UTR is NOT an input either, but an
  // extracted UTR that was already APPROVED elsewhere (payment or top-up)
  // rejects with DUPLICATE_UTR (handled inside applyTopupVerification).
  let outcome;
  try {
    const { verificationResult, verificationTime, utr } = await runScreenshotVerification({
      imageBuffer: file.buffer,
      expectedAmount: topup.amount,
      receiverUpi: RECEIVER_UPI,
    });
    outcome = await applyTopupVerification(topup, verificationResult, verificationTime);

    await logAction(userId, 'user', 'submit_topup_proof', topupId, 'topup', {
      filename,
      decision: verificationResult.decision,
      reason: verificationResult.reason,
      amountMatch: verificationResult.amountMatch,
      upiMatch: verificationResult.upiMatch,
      utr,
      credited: outcome.credited || false,
    });
  } catch (error) {
    // If the topup cannot be auto-verified (OCR failure) it must STAY
    // submittable so the user can retry — never lock it into a terminal state.
    if (error.code === 'OCR_FAILED' || error.code === 'OCR_UNREADABLE') {
      await logAction(userId, 'user', 'submit_topup_proof', topupId, 'topup', { filename, error: error.code });
      throw error;
    }
    throw error;
  }

  return {
    message: outcome.credited
      ? 'Topup approved and amount credited to your balance'
      : outcome.reason === 'DUPLICATE_UTR'
        ? 'Topup rejected: duplicate UTR detected'
        : 'Topup rejected',
    topupId,
    credited: outcome.credited || false,
    reason: outcome.reason || null,
  };
}

// ─────────────────────────────────────────────────────────────
// Applies the OCR verification decision to a top-up record.
//
// Idempotency for the balance credit is enforced by the top-up RECORD
// STATUS (an atomic guarded UPDATE), NOT by UTR:
//   - The top-up transitions submittable -> completed in a single
//     WHERE status IN (...) UPDATE. Only the caller that flips the
//     status proceeds to credit the wallet. Concurrent double-submits
//     get 0 rows and never re-credit.
//   - creditTopupBalanceOnce checks for an existing wallet_transaction
//     with reference_id = topup.id as an additional guard.
// ─────────────────────────────────────────────────────────────
export async function applyTopupVerification(topup, verificationResult, verificationTime) {
  const { decision, reason } = verificationResult;

  if (decision === 'approved') {
    // IMMEDIATE COMPLETION: payment verified → completed (matching registration
    // payment pattern). Both sender and receiver wallets are credited in a
    // single step. No separate claim step needed.
    const { data: updated, error } = await supabase
      .from('topups')
      .update({
        status: 'completed',
        completed_at: verificationTime.toISOString(),
        verified_at: verificationTime.toISOString(),
        verification_result: verificationResult,
      })
      .eq('id', topup.id)
      .in('status', SUBMITTABLE_STATUSES)
      .select('id, status');
    if (error) throw { message: error.message || 'Failed to complete topup', code: 'COMPLETE_FAILED', detail: error.details || error.hint || null };

    if (!updated || updated.length === 0) {
      return { credited: false, alreadyProcessed: true };
    }

    // Approved-UTR duplicate gate (AFTER the atomic transition).
    const verificationUtr = verificationResult.utr || null;
    if (verificationUtr) {
      const reserve = await reserveApprovedUtr(verificationUtr, 'topup', topup.id);
      if (reserve.duplicate) {
        await supabase
          .from('topups')
          .update({
            status: 'rejected',
            rejection_reason: 'DUPLICATE_UTR',
            verified_at: verificationTime.toISOString(),
            verification_result: verificationResult,
          })
          .eq('id', topup.id)
          .eq('status', 'completed');
        return { credited: false, alreadyProcessed: false, reason: 'DUPLICATE_UTR' };
      }
    }

    // Credit BOTH sender and receiver wallets exactly once.
    const senderCredited = await creditSenderOnce(topup);
    const receiverCredited = await creditReceiverOnce(topup);
    return { credited: senderCredited || receiverCredited, alreadyProcessed: false, pendingClaim: false };
  }

  const { error } = await supabase
    .from('topups')
    .update({
      status: 'rejected',
      rejection_reason: reason,
      verified_at: verificationTime.toISOString(),
      verification_result: verificationResult,
    })
    .eq('id', topup.id)
    .in('status', SUBMITTABLE_STATUSES);
  if (error) throw { message: 'Failed to reject topup', code: 'REJECT_FAILED' };

  return { credited: false, alreadyProcessed: false };
}

// Credit the SENDER's wallet once (their payment was verified).
// Idempotent: checks for an existing wallet_transaction with this topup's id + user_id.
async function creditSenderOnce(topup) {
  const { data: existing, error: checkError } = await supabase
    .from('wallet_transactions')
    .select('id')
    .eq('reference_id', topup.id)
    .eq('reference_type', 'topup')
    .eq('user_id', topup.sender_id)
    .limit(1);
  if (checkError) throw { message: 'Failed to check existing sender credit', code: 'CREDIT_CHECK_FAILED' };
  if (existing && existing.length > 0) return false;

  await walletService.credit(topup.sender_id, topup.amount, 'Top-up payment verified', topup.id, 'topup');
  return true;
}

// Credit the RECEIVER's wallet once when a top-up is completed.
// Idempotent: checks for an existing wallet_transaction with this topup's id + user_id.
async function creditReceiverOnce(topup) {
  const { data: existing, error: checkError } = await supabase
    .from('wallet_transactions')
    .select('id')
    .eq('reference_id', topup.id)
    .eq('reference_type', 'topup')
    .eq('user_id', topup.receiver_id)
    .limit(1);
  if (checkError) throw { message: 'Failed to check existing receiver credit', code: 'CREDIT_CHECK_FAILED' };
  if (existing && existing.length > 0) return false;

  await walletService.credit(topup.receiver_id, topup.amount, 'Top-up completed', topup.id, 'topup');
  return true;
}

export async function verifyTopup(topupId, adminId, approved, reason) {
  const { data: topup, error: fetchError } = await supabase.from('topups').select('*').eq('id', topupId).single();
  if (fetchError || !topup) throw { message: 'Topup not found', code: 'TOPUP_NOT_FOUND' };
  const VERIFIABLE_STATUSES = ['proof_submitted', 'verification_pending', 'manual_review'];
  if (!VERIFIABLE_STATUSES.includes(topup.status)) throw { message: 'Topup is not in a verifiable status', code: 'TOPUP_NOT_VERIFIABLE' };

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
