import { supabase } from '../db/supabase.js';
import { generateUniqueFilename, generateReferralCode } from '../utils/helpers.js';
import { logAction } from './auditService.js';
import { checkAndDeactivateReferrer } from './referralService.js';
import notificationService from './notificationService.js';
import walletService from './walletService.js';
import referralTierService from './referralTierService.js';
import { runOCR, extractPaymentData, matchAmount, matchUPI, normalizeUTR } from './ocrService.js';

const PLAN_AMOUNTS = { '120': 120, '500': 500, '1000': 1000 };
const RECEIVER_UPI = process.env.ADMIN_UPI_ID || 'jayarajj126-3@okicici';

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
  //    (e.g. the OCR auto-verify path updated it first) we proceed.
  const { data: approvedRows, error: payErr } = await supabase.from('payments')
    .update({ status: 'approved', approved_at: new Date().toISOString() })
    .eq('id', payment.id)
    .eq('status', 'pending')
    .select('id, status');
  if (payErr) throw { message: 'Failed to approve payment', code: 'APPROVE_FAILED' };
  if (!approvedRows || approvedRows.length === 0) {
    const { data: cur } = await supabase.from('payments').select('id, status').eq('id', payment.id).single();
    if (!cur) throw { message: 'Payment not found', code: 'PAYMENT_NOT_FOUND' };
    if (cur.status !== 'approved') throw { message: 'Payment is not in pending status', code: 'PAYMENT_NOT_PENDING' };
  }

  // 2. Activate user account (dashboard/wallet/referral access).
  const { data: userRows, error: userErr } = await supabase.from('users')
    .update({ status: 'active', current_plan: payment.selected_plan })
    .eq('id', payment.user_id)
    .eq('status', 'pending')
    .select('id, referred_by, referral_code');
  if (userErr || !userRows || userRows.length === 0) {
    await rollbackApproval(payment.id, payment.user_id);
    throw { message: 'Failed to activate user account', code: 'ACTIVATE_FAILED' };
  }

  // 3. Ensure referral link/code exists (referral system enablement).
  let referralCode = userRows[0].referral_code;
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
  const referrerId = userRows[0].referred_by || null;
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

  const { data: existingPending } = await supabase.from('payments').select('id').eq('user_id', userId).eq('status', 'pending').single();
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

  const filename = generateUniqueFilename(file.originalname);
  const filePath = `payments/${paymentId}/${filename}`;

  const { error: uploadError } = await supabase.storage.from('payments').upload(filePath, file.buffer, { contentType: file.mimetype, upsert: false });
  if (uploadError) throw { message: 'Failed to upload screenshot', code: 'UPLOAD_FAILED' };

  const { data: urlData } = supabase.storage.from('payments').getPublicUrl(filePath);
  const screenshotUrl = urlData.publicUrl;

  const { error: updateError } = await supabase.from('payments').update({ screenshot_url: screenshotUrl }).eq('id', paymentId);
  if (updateError) throw { message: 'Failed to save screenshot', code: 'SAVE_FAILED' };

  await logAction(userId, 'user', 'upload_screenshot', paymentId, 'payment', { filename });
  return { screenshotUrl, paymentId };
}

export async function verifyPayment(paymentId, imageBuffer) {
  const t0 = Date.now();
  const { data: payment, error: fetchError } = await supabase.from('payments').select('*').eq('id', paymentId).single();
  if (fetchError || !payment) throw { message: 'Payment not found', code: 'PAYMENT_NOT_FOUND' };
  if (!payment.screenshot_url && !imageBuffer) throw { message: 'No screenshot uploaded', code: 'NO_SCREENSHOT' };
  if (payment.status !== 'pending') throw { message: 'Payment is not in pending status', code: 'PAYMENT_NOT_PENDING' };

  let ocrText = '';
  let ocrConfidence = 0;
  let extractedAmounts = [];
  let extractedUPIs = [];
  let extractedUTRs = [];
  let extractedDates = [];

  try {
    let buffer = imageBuffer;
    if (!buffer && payment.screenshot_url) {
      const resp = await fetch(payment.screenshot_url);
      if (!resp.ok) throw { message: 'Failed to fetch screenshot', code: 'SCREENSHOT_FETCH_FAILED' };
      buffer = Buffer.from(await resp.arrayBuffer());
    }
    const ocr = await runOCR(buffer);
    ocrText = ocr.text;
    ocrConfidence = ocr.confidence;
    const extracted = extractPaymentData(ocrText);
    extractedAmounts = extracted.amounts;
    extractedUPIs = extracted.upis;
    extractedUTRs = extracted.utrs;
    extractedDates = extracted.dates;
  } catch (ocrErr) {
    throw { message: 'OCR processing failed', code: 'OCR_FAILED', details: ocrErr.message };
  }

  if (!ocrText || ocrText.trim().length < 5) {
    throw { message: 'OCR could not read the screenshot', code: 'OCR_UNREADABLE' };
  }

  const amountMatch = matchAmount(extractedAmounts, payment.expected_amount);
  const upiMatch = matchUPI(extractedUPIs, RECEIVER_UPI);
  const utr = extractedUTRs.length > 0 ? normalizeUTR(extractedUTRs[0]) : null;
  const date = extractedDates[0] || null;
  const verificationTime = new Date();

  const verificationResult = {
    ocrConfidence,
    extractedAmounts,
    extractedUPIs,
    extractedUTRs,
    extractedDates: extractedDates.map(d => d.toISOString()),
    amountMatch,
    upiMatch,
    utr: utr || null,
    dateValid: date ? (verificationTime.getTime() - date.getTime()) < 30 * 24 * 60 * 60 * 1000 : false,
    decision: null,
    reason: null,
  };

  if (!utr) {
    verificationResult.decision = 'rejected';
    verificationResult.reason = 'UTR_NOT_FOUND';
  } else if (!amountMatch) {
    verificationResult.decision = 'rejected';
    verificationResult.reason = 'AMOUNT_MISMATCH';
  } else if (!upiMatch) {
    verificationResult.decision = 'rejected';
    verificationResult.reason = 'UPI_MISMATCH';
  } else {
    const { data: existingPayment } = await supabase.from('payments')
      .select('id, user_id, status').eq('transaction_id', utr).neq('id', paymentId).single();
    if (existingPayment) {
      verificationResult.decision = 'rejected';
      verificationResult.reason = 'DUPLICATE_UTR';
    } else {
      verificationResult.decision = 'approved';
      verificationResult.reason = null;
    }
  }

  const newStatus = verificationResult.decision === 'approved' ? 'approved' : 'rejected';
  const updateData = {
    verification_result: verificationResult,
    verified_at: verificationTime.toISOString(),
    transaction_id: newStatus === 'approved' ? utr : null,
    status: newStatus,
  };
  if (newStatus === 'approved') updateData.approved_at = verificationTime.toISOString();
  if (newStatus === 'rejected') {
    updateData.rejected_at = verificationTime.toISOString();
    updateData.rejection_reason = verificationResult.reason;
  }

  const { error: updateError } = await supabase.from('payments').update(updateData).eq('id', paymentId).eq('status', 'pending');
  if (updateError) throw { message: 'Failed to update payment status', code: 'DATABASE_UPDATE_FAILED' };

  const { data: updatedPayment } = await supabase.from('payments').select('*').eq('id', paymentId).single();
  if (updatedPayment.status !== newStatus) {
    throw { message: 'Concurrent modification detected', code: 'RACE_CONDITION' };
  }

  if (newStatus === 'approved') {
    try {
      await completeApproval(payment, payment.user_id, 'system', 'verify_payment');
    } catch (approvalErr) {
      // Atomic approval failed — roll back payment to pending so no partial activation.
      await supabase.from('payments')
        .update({ status: 'pending', approved_at: null, transaction_id: null })
        .eq('id', paymentId);
      throw approvalErr;
    }
  } else if (newStatus === 'rejected') {
    try {
      await notificationService.createNotification(
        payment.user_id, 'payment_rejected', 'Payment Rejected',
        `Your payment of ₹${payment.expected_amount} was rejected. Reason: ${verificationResult.reason}`,
        { paymentId, amount: payment.expected_amount, reason: verificationResult.reason }
      );
    } catch (e) { /* non-blocking */ }
  }

  const elapsed = Date.now() - t0;
  await logAction(payment.user_id, 'system', 'verify_payment', paymentId, 'payment', {
    decision: verificationResult.decision,
    reason: verificationResult.reason,
    amountMatch,
    upiMatch,
    utr,
    ocrConfidence,
    elapsedMs: elapsed,
  });

  return {
    paymentId,
    status: newStatus,
    decision: verificationResult.decision,
    reason: verificationResult.reason,
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
  if (payment.status !== 'pending') throw { message: 'Payment is not in pending status', code: 'PAYMENT_NOT_PENDING' };

  return await completeApproval(payment, adminId, 'admin', 'approve_payment');
}

export async function rejectPayment(paymentId, adminId, reason) {
  const { data: payment, error: fetchError } = await supabase.from('payments').select('*').eq('id', paymentId).single();
  if (fetchError || !payment) throw { message: 'Payment not found', code: 'PAYMENT_NOT_FOUND' };
  if (payment.status !== 'pending') throw { message: 'Payment is not in pending status', code: 'PAYMENT_NOT_PENDING' };

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
