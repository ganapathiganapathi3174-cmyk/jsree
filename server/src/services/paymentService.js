import crypto from 'crypto';
import { supabase } from '../db/supabase.js';
import { generateUniqueFilename, generateReferralCode } from '../utils/helpers.js';
import { logAction } from './auditService.js';
import { checkAndDeactivateReferrer } from './referralService.js';
import notificationService from './notificationService.js';
import walletService from './walletService.js';
import referralTierService from './referralTierService.js';
import { runScreenshotVerification, decidePaymentVerification, reserveApprovedUtr, releaseApprovedUtr } from './verificationService.js';
import { RECEIVER_UPI } from '../config/paymentConfig.js';

// Re-exported for callers/tests that import the decision engine here.
export { decidePaymentVerification };

const PLAN_AMOUNTS = { '120': 120, '500': 500, '1000': 1000 };
// Statuses an admin can act on (approve / reject / re-verify).
const ACTABLE_STATUSES = ['pending', 'manual_review'];

// ─────────────────────────────────────────────────────────────
// Atomic approval of an initial registration payment.
//
// Critical path (must all succeed or the whole thing rolls back):
//   1. PAYMENT        -> approved
//   2. USER           -> active (dashboard/wallet/referral access enabled)
//   3. REFERRAL LINK  -> generated (ensured present)
//   4. NOTIFICATION   -> payment_approved
// Side effects (referral bonus, tier upgrades) are non-blocking.
//
// Uses guarded row updates (WHERE status = 'pending') so concurrent
// approve/delete operations cannot produce inconsistent state.
// ─────────────────────────────────────────────────────────────
async function rollbackApproval(paymentId, userId) {
  await supabase.from('payments').update({ status: 'pending', approved_at: null }).eq('id', paymentId);
  await supabase.from('users').update({ status: 'pending' }).eq('id', userId);
}

async function completeApproval(payment, actorId, actorType, logActionType) {
  // 1. Mark payment approved (guarded, race-safe). If it is already approved
  //    (e.g. the OCR auto-verify path updated it first, or an admin retry
  //    after a partial failure) we proceed without error.
  const { data: approvedRows, error: payErr } = await supabase.from('payments')
    .update({ status: 'approved', approved_at: new Date().toISOString() })
    .eq('id', payment.id)
    .in('status', ACTABLE_STATUSES)
    .select('id, status');
  if (payErr) throw { message: 'Failed to approve payment', code: 'APPROVE_FAILED' };
  if (!approvedRows || approvedRows.length === 0) {
    const { data: cur } = await supabase.from('payments').select('id, status').eq('id', payment.id).single();
    if (!cur) throw { message: 'Payment not found', code: 'PAYMENT_NOT_FOUND' };
    if (cur.status !== 'approved') throw { message: 'Payment is not in an actionable status', code: 'PAYMENT_NOT_PENDING' };
  }

  // 2. Activate user account (dashboard/wallet/referral access).
  //    Idempotent: if the account is already active (retry/duplicate admin
  //    action) we must NOT roll back an otherwise-fine approval — the only
  //    failure worth rolling back is a genuinely non-activatable account.
  const { data: userRows, error: userErr } = await supabase.from('users')
    .update({ status: 'active', current_plan: payment.selected_plan })
    .eq('id', payment.user_id)
    .eq('status', 'pending')
    .select('id, referred_by, referral_code');
  if (userErr) {
    await rollbackApproval(payment.id, payment.user_id);
    throw { message: 'Failed to activate user account', code: 'ACTIVATE_FAILED' };
  }
  let activeUser = userRows && userRows.length > 0 ? userRows[0] : null;
  if (!activeUser) {
    const { data: curUser } = await supabase.from('users')
      .select('id, referred_by, referral_code, status')
      .eq('id', payment.user_id)
      .single();
    if (!curUser) {
      await rollbackApproval(payment.id, payment.user_id);
      throw { message: 'Payment user not found', code: 'PAYMENT_USER_NOT_FOUND' };
    }
    if (curUser.status !== 'active') {
      await rollbackApproval(payment.id, payment.user_id);
      throw { message: 'Failed to activate user account', code: 'ACTIVATE_FAILED' };
    }
    activeUser = curUser;
  }

  // 3. Ensure referral link/code exists (referral system enablement).
  let referralCode = activeUser.referral_code;
  if (!referralCode) {
    referralCode = generateReferralCode();
    const { error: refErr } = await supabase.from('users')
      .update({ referral_code: referralCode })
      .eq('id', payment.user_id);
    if (refErr) {
      await rollbackApproval(payment.id, payment.user_id);
      throw { message: 'Failed to generate referral code', code: 'REFERRAL_CODE_FAILED' };
    }
  }

  // 4. Create payment_approved notification (part of activation).
  try {
    await notificationService.createNotification(
      payment.user_id, 'payment_approved', 'Payment Approved',
      `Your payment of ₹${payment.expected_amount} for plan ${payment.selected_plan} months has been approved.`,
      { paymentId: payment.id, amount: payment.expected_amount, plan: payment.selected_plan }
    );
  } catch (notifErr) {
    await rollbackApproval(payment.id, payment.user_id);
    throw { message: 'Failed to create approval notification', code: 'NOTIFICATION_FAILED' };
  }

  // 5. Side effects — non-blocking (referrer deactivation, wallet bonus, tiers).
  const referrerId = activeUser.referred_by || null;
  try {
    if (referrerId) {
      await checkAndDeactivateReferrer(referrerId).catch(() => {});
    }
    const bonusAmount = parseFloat(payment.expected_amount) * 0.05;
    if (referrerId) {
      await walletService.credit(referrerId, bonusAmount, `Referral bonus for payment by user`, payment.id, 'referral_bonus');
      await notificationService.createNotification(
        referrerId, 'wallet_credit', 'Referral Bonus',
        `You received ₹${bonusAmount} referral bonus.`,
        { amount: bonusAmount, paymentId: payment.id }
      );
    }
    await referralTierService.checkAndUpgradeTier(payment.user_id);
    if (referrerId) {
      await referralTierService.checkAndUpgradeTier(referrerId);
    }
  } catch (e) { /* non-blocking */ }

  await logAction(actorId, actorType, logActionType, payment.id, 'payment', {
    userId: payment.user_id, amount: payment.expected_amount, plan: payment.selected_plan
  });

  return { message: 'Payment approved successfully', paymentId: payment.id };
}

export async function createPayment(userId, planData) {
  const { plan } = planData;
  const amount = PLAN_AMOUNTS[plan];
  if (!amount) throw { message: 'Invalid plan selected', code: 'INVALID_PLAN' };

  const { data: existingPending } = await supabase.from('payments').select('id').eq('user_id', userId).in('status', ['pending', 'manual_review']).single();
  if (existingPending) throw { message: 'You already have a pending payment', code: 'PENDING_EXISTS' };

  const { data: existingApproved } = await supabase.from('payments').select('id').eq('user_id', userId).eq('status', 'approved').single();
  if (existingApproved) throw { message: 'You already have an approved payment', code: 'PAYMENT_EXISTS' };

  const { data: payment, error } = await supabase.from('payments').insert({
    user_id: userId, selected_plan: parseInt(plan), expected_amount: amount, upi_id: RECEIVER_UPI, status: 'pending'
  }).select('*').single();

  if (error) throw { message: 'Failed to create payment', code: 'PAYMENT_CREATE_FAILED' };
  await logAction(userId, 'user', 'create_payment', payment.id, 'payment', { plan: parseInt(plan), amount });
  return payment;
}

export async function uploadScreenshot(paymentId, file, userId) {
  const { data: payment } = await supabase.from('payments').select('id, user_id, status').eq('id', paymentId).single();
  if (!payment) throw { message: 'Payment not found', code: 'PAYMENT_NOT_FOUND' };
  if (payment.user_id !== userId) throw { message: 'Unauthorized', code: 'UNAUTHORIZED' };
  if (payment.status !== 'pending') throw { message: 'Payment is not in pending status', code: 'PAYMENT_NOT_PENDING' };

  // Screenshot content hash — used to detect the SAME proof image being
  // reused for multiple registrations (duplicate-proof rule). Only an
  // APPROVED payment's hash blocks reuse; a rejected/pending screenshot
  // can always be resubmitted.
  const screenshotHash = crypto.createHash('sha256').update(file.buffer).digest('hex');
  const { data: reuse } = await supabase.from('payments')
    .select('id')
    .eq('screenshot_hash', screenshotHash)
    .eq('status', 'approved')
    .neq('id', paymentId)
    .limit(1);
  if (reuse && reuse.length > 0) {
    throw {
      message: 'This screenshot was already used for an approved payment',
      code: 'DUPLICATE_SCREENSHOT',
    };
  }

  const filename = generateUniqueFilename(file.originalname);
  const filePath = `payments/${paymentId}/${filename}`;

  const { error: uploadError } = await supabase.storage.from('payments').upload(filePath, file.buffer, { contentType: file.mimetype, upsert: false });
  if (uploadError) throw { message: 'Failed to upload screenshot', code: 'UPLOAD_FAILED' };

  const { data: urlData } = supabase.storage.from('payments').getPublicUrl(filePath);
  const screenshotUrl = urlData.publicUrl;

  const { error: updateError } = await supabase.from('payments').update({
    screenshot_url: screenshotUrl,
    screenshot_hash: screenshotHash,
  }).eq('id', paymentId);
  if (updateError) throw { message: 'Failed to save screenshot', code: 'SAVE_FAILED' };

  await logAction(userId, 'user', 'upload_screenshot', paymentId, 'payment', { filename, screenshotHash });
  return { screenshotUrl, paymentId };
}

// ─────────────────────────────────────────────────────────────
// Approved-UTR duplicate policy for registration payments.
//
// OCR gives { decision, utr }. UTR must NEVER influence the OCR decision —
// it only gates APPROVAL against previously APPROVED UTRs. If the extracted
// UTR was already reserved (payment or top-up), the payment is REJECTED with
// DUPLICATE_UTR. Missing/random UTRs pass through untouched.
//
// Atomic + race-safe: reserveApprovedUtr uses INSERT ... ON CONFLICT (unique
// index on approved_utrs.utr, migration 007) — never SELECT-then-INSERT.
// Returns { newStatus, reason, reservedUtr }.
// ─────────────────────────────────────────────────────────────
export async function applyPaymentUtrPolicy(paymentId, { decision, utr }) {
  let newStatus = decision === 'approved' ? 'approved' : 'rejected';
  let reason = null;
  let reservedUtr = null;

  // UTR reservation happens ONLY on auto-approve.
  if (decision === 'approved' && utr) {
    const reserve = await reserveApprovedUtr(utr, 'payment', paymentId);
    if (reserve.duplicate) {
      newStatus = 'rejected';
      reason = 'DUPLICATE_UTR';
    } else if (reserve.reserved) {
      reservedUtr = reserve.utr;
    }
  }

  return { newStatus, reason, reservedUtr };
}

export async function verifyPayment(paymentId, imageBuffer) {
  const t0 = Date.now();
  const { data: payment, error: fetchError } = await supabase.from('payments').select('*').eq('id', paymentId).single();
  if (fetchError || !payment) throw { message: 'Payment not found', code: 'PAYMENT_NOT_FOUND' };
  if (!payment.screenshot_url && !imageBuffer) throw { message: 'No screenshot uploaded', code: 'NO_SCREENSHOT' };
  if (!payment.status || !ACTABLE_STATUSES.includes(payment.status)) throw { message: 'Payment is not in a verifiable status', code: 'PAYMENT_NOT_PENDING' };

  const { verificationResult, verificationTime, utr } = await runScreenshotVerification({
    imageBuffer: imageBuffer || null,
    screenshotUrl: payment.screenshot_url || null,
    expectedAmount: payment.expected_amount,
    receiverUpi: RECEIVER_UPI,
  });
  const { decision } = verificationResult;

  // Approved-UTR duplicate gate. A UTR that was already APPROVED (for any
  // payment or top-up) rejects this request with DUPLICATE_UTR — no user
  // activation. Missing/random UTRs skip the check entirely.
  const { newStatus, reason, reservedUtr } = await applyPaymentUtrPolicy(payment.id, { decision, utr });

  let effectiveReason = reason;
  if (!effectiveReason && newStatus === 'rejected') {
    effectiveReason = verificationResult.reason || 'REJECTED';
  }
  if (effectiveReason === 'DUPLICATE_UTR') {
    // Reflect the duplicate gate in the persisted structured result.
    verificationResult.decision = 'rejected';
    verificationResult.reason = 'DUPLICATE_UTR';
    verificationResult.checks = { ...verificationResult.checks, duplicate: { passed: false, utr } };
  }

  const updateData = {
    verification_result: verificationResult,
    verified_at: verificationTime.toISOString(),
    transaction_id: newStatus === 'approved' ? utr : null,
    status: newStatus,
  };
  if (newStatus === 'approved') updateData.approved_at = verificationTime.toISOString();
  if (newStatus === 'rejected') {
    updateData.rejected_at = verificationTime.toISOString();
    updateData.rejection_reason = effectiveReason;
  }

  const { error: updateError } = await supabase.from('payments').update(updateData).eq('id', paymentId).in('status', ACTABLE_STATUSES);
  if (updateError) {
    if (reservedUtr) await releaseApprovedUtr(reservedUtr, 'payment', paymentId);
    throw { message: 'Failed to update payment status', code: 'DATABASE_UPDATE_FAILED' };
  }

  const { data: updatedPayment } = await supabase.from('payments').select('*').eq('id', paymentId).single();
  if (updatedPayment.status !== newStatus) {
    if (reservedUtr) await releaseApprovedUtr(reservedUtr, 'payment', paymentId);
    throw { message: 'Concurrent modification detected', code: 'RACE_CONDITION' };
  }

  if (newStatus === 'approved') {
    try {
      await completeApproval(payment, payment.user_id, 'system', 'verify_payment');
    } catch (approvalErr) {
      // Atomic approval failed — roll back payment to pending so no partial
      // activation, and release the UTR reservation so it can be retried.
      await supabase.from('payments')
        .update({ status: 'pending', approved_at: null })
        .eq('id', paymentId);
      if (reservedUtr) await releaseApprovedUtr(reservedUtr, 'payment', paymentId);
      throw approvalErr;
    }
  } else if (newStatus === 'rejected') {
    try {
      await notificationService.createNotification(
        payment.user_id, 'payment_rejected', 'Payment Rejected',
        `Your payment of ₹${payment.expected_amount} was rejected. Reason: ${effectiveReason}`,
        { paymentId, amount: payment.expected_amount, reason: effectiveReason }
      );
    } catch (e) { /* non-blocking */ }
  }

  const elapsed = Date.now() - t0;
  await logAction(payment.user_id, 'system', 'verify_payment', paymentId, 'payment', {
    decision: newStatus,
    reason: effectiveReason,
    amountMatch: verificationResult.amountMatch,
    upiMatch: verificationResult.upiMatch,
    utr,
    ocrConfidence: verificationResult.ocrConfidence,
    elapsedMs: elapsed,
  });

  return {
    paymentId,
    status: newStatus,
    decision: newStatus,
    reason: effectiveReason,
    verificationResult,
    elapsed,
  };
}

export async function getPaymentStatus(paymentId) {
  const { data: payment, error } = await supabase.from('payments').select('id, selected_plan, expected_amount, status, created_at, verified_at, verification_result, rejection_reason').eq('id', paymentId).single();
  if (error || !payment) throw { message: 'Payment not found', code: 'PAYMENT_NOT_FOUND' };
  return payment;
}

export async function getUserPayments(userId) {
  const { data: payments, error } = await supabase.from('payments')
    .select('id, selected_plan, expected_amount, status, screenshot_url, rejection_reason, verification_result, submitted_at, verified_at, approved_at, rejected_at, created_at')
    .eq('user_id', userId).order('created_at', { ascending: false });
  if (error) throw { message: 'Failed to fetch payments', code: 'FETCH_FAILED' };
  return payments;
}

export async function approvePayment(paymentId, adminId) {
  const { data: payment, error: fetchError } = await supabase.from('payments').select('*').eq('id', paymentId).single();
  if (fetchError || !payment) throw { message: 'Payment not found', code: 'PAYMENT_NOT_FOUND' };
  if (!payment.status || !ACTABLE_STATUSES.includes(payment.status)) throw { message: 'Payment is not in an actionable status', code: 'PAYMENT_NOT_PENDING' };

  // Defensive approved-UTR gate for admin approvals that carry a UTR
  // (normally only OCR auto-verify sets transaction_id, so this is a no-op).
  let reservedUtr = null;
  const utrToReserve = payment.transaction_id || (payment.verification_result?.utr) || null;
  if (utrToReserve) {
    const reserve = await reserveApprovedUtr(utrToReserve, 'payment', payment.id);
    if (reserve.duplicate) throw { message: 'Duplicate UTR detected', code: 'DUPLICATE_UTR' };
    if (reserve.reserved) reservedUtr = reserve.utr;
  }

  try {
    return await completeApproval(payment, adminId, 'admin', 'approve_payment');
  } catch (err) {
    if (reservedUtr) await releaseApprovedUtr(reservedUtr, 'payment', payment.id);
    throw err;
  }
}

export async function rejectPayment(paymentId, adminId, reason) {
  const { data: payment, error: fetchError } = await supabase.from('payments').select('*').eq('id', paymentId).single();
  if (fetchError || !payment) throw { message: 'Payment not found', code: 'PAYMENT_NOT_FOUND' };
  if (!payment.status || !ACTABLE_STATUSES.includes(payment.status)) throw { message: 'Payment is not in an actionable status', code: 'PAYMENT_NOT_PENDING' };

  const { error } = await supabase.from('payments').update({ status: 'rejected', rejected_at: new Date().toISOString(), rejection_reason: reason }).eq('id', paymentId);
  if (error) throw { message: 'Failed to reject payment', code: 'REJECT_FAILED' };

  try {
    await notificationService.createNotification(
      payment.user_id, 'payment_rejected', 'Payment Rejected',
      `Your payment of ₹${payment.expected_amount} was rejected. Reason: ${reason || 'Not specified'}`,
      { paymentId, amount: payment.expected_amount, reason }
    );
  } catch (e) { /* non-blocking */ }

  await logAction(adminId, 'admin', 'reject_payment', paymentId, 'payment', { userId: payment.user_id, amount: payment.expected_amount, reason });
  return { message: 'Payment rejected', paymentId };
}

// ─────────────────────────────────────────────────────────────
// Whether a registration/payment carries immutable financial data.
// If TRUE, permanent deletion is blocked and soft-delete must be used.
// ─────────────────────────────────────────────────────────────
export async function hasFinancialHistory(userId, payment = null) {
  if (payment && payment.status === 'approved') return true;

  const [{ count: approvedCount }, { count: walletCount }, { data: topups }] = await Promise.all([
    supabase.from('payments').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'approved'),
    supabase.from('wallet_transactions').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('topups').select('id, status').or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
  ]);

  if (approvedCount > 0) return true;
  if (walletCount > 0) return true;
  if (topups && topups.some(t => ['completed', 'approved'].includes(t.status))) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────
// Admin delete of a payment + its pending registration.
//
// Only unapproved registrations with NO financial ledger activity may be
// permanently deleted. Approved / financially-relevant users are blocked
// (use soft-delete / retention instead). RBAC is enforced at the route level.
//
// Returns { alreadyDeleted: true } for idempotent double-click safety.
// ─────────────────────────────────────────────────────────────
export async function deletePayment(paymentId, adminId) {
  const { data: payment, error: fetchError } = await supabase.from('payments').select('*').eq('id', paymentId).single();
  if (fetchError || !payment) {
    return { message: 'Payment already deleted', paymentId, alreadyDeleted: true };
  }

  const userId = payment.user_id;
  const { data: user } = await supabase.from('users').select('id, role, status, full_name, email').eq('id', userId).single();

  // Block permanent deletion for financially-relevant records.
  if (await hasFinancialHistory(userId, payment)) {
    throw {
      message: 'This account contains financial records and cannot be permanently deleted. Use the approved retention/soft-delete process.',
      code: 'FINANCIAL_HISTORY_EXISTS'
    };
  }

  // ---- Controlled permanent deletion of an unapproved registration ----

  // 1. Remove uploaded screenshot from storage.
  if (payment.screenshot_url) {
    try {
      const url = new URL(payment.screenshot_url);
      const pathMatch = url.pathname.split('/');
      const bucketIdx = pathMatch.indexOf('payments');
      const objectPath = bucketIdx >= 0 ? pathMatch.slice(bucketIdx + 1).join('/') : null;
      if (objectPath) {
        await supabase.storage.from('payments').remove([objectPath]);
      }
    } catch (e) { /* non-blocking */ }
  }

  // 2. Remove temporary/pending related data before touching the payment row.
  const { error: refErr } = await supabase.from('referrals').delete().or(`referrer_id.eq.${userId},referred_user_id.eq.${userId}`);
  if (refErr) throw { message: 'Failed to clean referral data', code: 'DELETE_CLEANUP_FAILED' };

  const { error: notifErr } = await supabase.from('notifications').delete().eq('user_id', userId);
  if (notifErr) throw { message: 'Failed to clean notification data', code: 'DELETE_CLEANUP_FAILED' };

  const { error: msgErr } = await supabase.from('messages').delete().eq('sender_id', userId);
  const { error: convErr } = await supabase.from('conversations').delete().eq('user_id', userId);
  const { error: planErr } = await supabase.from('plan_change_requests').delete().eq('user_id', userId);
  const { error: ipErr } = await supabase.from('ip_logs').delete().eq('user_id', userId);
  const { error: suspErr } = await supabase.from('suspicious_activity').delete().eq('user_id', userId);
  const { error: topErr } = await supabase.from('topups').delete().or(`sender_id.eq.${userId},receiver_id.eq.${userId}`);
  const { error: auditErr } = await supabase.from('audit_logs').delete().eq('actor_id', userId);
  if (msgErr || convErr || planErr || ipErr || suspErr || topErr || auditErr) {
    throw { message: 'Failed to clean related registration data', code: 'DELETE_CLEANUP_FAILED' };
  }

  // 3. Delete payment row.
  const { error: payDelErr } = await supabase.from('payments').delete().eq('id', paymentId);
  if (payDelErr) throw { message: 'Failed to delete payment', code: 'DELETE_FAILED' };

  // 4. Delete the pending registration (user). Compensate if user delete fails.
  const { error: userDelErr } = await supabase.from('users').delete().eq('id', userId);
  if (userDelErr) {
    await supabase.from('payments').insert(payment);
    throw { message: 'Failed to delete pending registration', code: 'DELETE_FAILED' };
  }

  // 5. Audit record (preserved as the required audit trail).
  await logAction(adminId, 'admin', 'delete_payment_registration', paymentId, 'payment', {
    userId,
    amount: payment.expected_amount,
    plan: payment.selected_plan,
    reason: 'Pending registration permanently removed'
  });

  return { message: 'Pending registration deleted', paymentId, userId, deleted: true };
}
