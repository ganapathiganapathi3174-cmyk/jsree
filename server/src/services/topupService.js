import crypto from 'crypto';
import { supabase } from '../db/supabase.js';
import { generateUniqueFilename } from '../utils/helpers.js';
import { logAction } from './auditService.js';
import { checkAndDeactivateReferrer } from './referralService.js';
import walletService from './walletService.js';
import {
  normalizeUtr,
  reserveApprovedUtr,
  releaseApprovedUtr,
  requireExternalPaymentConfirmation,
} from './verificationService.js';
import { paymentValidationEngine } from './paymentValidationService.js';
import { getPaymentConfig } from './configService.js';
import { verifyTransaction, getProviderMode } from './paymentProviderService.js';
import { recordVerificationAttempt, deriveOutcomeStatus } from './paymentVerificationHistoryService.js';
// Shared server-authoritative payment configuration and expiry helper —
// the SAME values and the SAME fail-closed check the membership flow uses.
// There is exactly one validation engine (paymentValidationEngine) and one
// expiry rule; top-ups only add their own post-verification business action.
import { RECEIVER_UPI, RECEIVER_NAME, OCR_VERIFICATION_BUDGET_MS, PAYMENT_TIME_WINDOW_MINUTES, SENDER_NAME_POLICY, isPaymentAutoApproveEnabled } from '../config/paymentConfig.js';
// Rule A — the top-up amount is resolved from the SAME server-side plan
// table the register flow uses (config/paymentConfig). A client-supplied
// amount is only ever a lookup key; it is never trusted as the price.
import { resolvePlanAmount } from '../utils/paymentNormalize.js';
import { isPaymentExpired } from './paymentService.js';

const SUBMITTABLE_STATUSES = ['created', 'payment_pending'];
export const TOPUP_RECEIVED_REQUIRED = 2;

export async function createTopup(senderId, receiverId, amount) {
  // Resolve the amount server-side. `null` means the requested amount is not
  // one of the configured plans.
  const resolvedAmount = resolvePlanAmount(amount);
  if (resolvedAmount === null) throw { message: 'Invalid amount', code: 'INVALID_AMOUNT' };

  // Enforce: top-up amount must match the sender's current active plan.
  const { data: sender } = await supabase.from('users').select('current_plan').eq('id', senderId).single();
  if (!sender) throw { message: 'Sender not found', code: 'SENDER_NOT_FOUND' };
  const senderPlan = Number(sender.current_plan);
  if (senderPlan && resolvedAmount !== senderPlan) {
    throw { message: 'Top-up amount must match your current plan', code: 'INVALID_AMOUNT' };
  }

  const { data: existingTopup } = await supabase.from('topups').select('id')
    .eq('sender_id', senderId).eq('receiver_id', receiverId)
    .in('status', ['created', 'payment_pending', 'proof_submitted', 'verification_pending']).single();
  if (existingTopup) throw { message: 'A pending topup already exists for this receiver', code: 'TOPUP_EXISTS' };

  // Server-generated payment request: immutable 30-minute window, server
  // receiver UPI, explicit payment type. The client only selects the plan.
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PAYMENT_TIME_WINDOW_MINUTES * 60 * 1000);

  const { data: topup, error } = await supabase.from('topups').insert({
    sender_id: senderId, receiver_id: receiverId, amount: resolvedAmount, plan: resolvedAmount, status: 'created',
    payment_type: 'TOPUP', receiver_upi: RECEIVER_UPI, expires_at: expiresAt.toISOString(),
  }).select('*').single();

  if (error) throw { message: 'Failed to create topup', code: 'TOPUP_CREATE_FAILED' };

  await logAction(senderId, 'user', 'create_topup', topup.id, 'topup', { receiverId, amount: resolvedAmount });
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
  // Rule A — resolve the amount server-side before anything is persisted.
  const resolvedAmount = resolvePlanAmount(amount);
  if (resolvedAmount === null) throw { message: 'Invalid amount', code: 'INVALID_AMOUNT' };

  // Enforce: top-up amount must match the sender's current active plan.
  const { data: sender } = await supabase.from('users').select('id, referred_by, current_plan').eq('id', senderId).single();
  if (!sender) throw { message: 'Sender not found', code: 'SENDER_NOT_FOUND' };
  const senderPlan = Number(sender.current_plan);
  if (senderPlan && resolvedAmount !== senderPlan) {
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
  const topup = existing || (await createTopup(senderId, targetReceiverId, resolvedAmount));

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

  // ── Payment expiry gate (pre-upload) ──
  // Same server-authoritative 30-minute rule as membership payments.
  // Rejects BEFORE storage upload / expensive OCR when the window passed.
  if (isPaymentExpired(topup)) {
    throw {
      message: 'Payment request expired. The 30-minute payment window has ended. Please create a new payment request.',
      code: 'PAYMENT_EXPIRED',
    };
  }

  // ── Screenshot duplicate gate (mirrors membership DUPLICATE_SCREENSHOT) ──
  // The SAME proof image may not back two COMPLETED top-ups. Rejected or
  // still-pending screenshots can always be resubmitted.
  const screenshotHash = crypto.createHash('sha256').update(file.buffer).digest('hex');
  const { data: reuse } = await supabase.from('topups')
    .select('id')
    .eq('screenshot_hash', screenshotHash)
    .eq('status', 'completed')
    .neq('id', topupId)
    .limit(1);
  if (reuse && reuse.length > 0) {
    throw {
      message: 'This screenshot was already used for a completed top-up',
      code: 'DUPLICATE_SCREENSHOT',
    };
  }

  const filename = generateUniqueFilename(file.originalname);
  const filePath = `topups/${topupId}/${filename}`;

  const { error: uploadError } = await supabase.storage.from('payments').upload(filePath, file.buffer, { contentType: file.mimetype, upsert: false });
  if (uploadError) throw { message: 'Failed to upload proof', code: 'UPLOAD_FAILED' };

  const { data: urlData } = supabase.storage.from('payments').getPublicUrl(filePath);
  const screenshotUrl = urlData.publicUrl;

  const { error: saveError } = await supabase.from('topups').update({ screenshot_url: screenshotUrl, screenshot_hash: screenshotHash }).eq('id', topupId);
  if (saveError) throw { message: 'Failed to update topup', code: 'UPDATE_FAILED' };

    // The SAME centralized validation engine the registration flow uses —
    // amount / receiver-name / payer-name / transaction-date / transaction-time
    // / transaction-id / image-integrity / duplicate rules are identical
    // across flows. The UTR is not an input to the OCR decision, but an
    // extracted UTR that was already APPROVED elsewhere (payment or top-up)
    // rejects with DUPLICATE_UTR (handled inside applyTopupVerification).
    let outcome;
  try {
    // Same shared receiver-name secondary gate as the membership flow.
    const paymentConfig = await getPaymentConfig();
    const receiverName = paymentConfig.receiver_name || RECEIVER_NAME || '';

    // Expected payer identity (Rule B): the top-up SENDER's own full name.
    let expectedPayerName = null;
    if (SENDER_NAME_POLICY !== 'off') {
      const { data: senderUser } = await supabase.from('users').select('full_name').eq('id', topup.sender_id).single();
      expectedPayerName = senderUser?.full_name || null;
    }

    const engineResult = await paymentValidationEngine.validatePayment({
      imageBuffer: file.buffer,
      paymentRequest: {
        type: 'topup',
        expectedAmount: topup.amount,
        paymentId: topup.id,
        userId: topup.sender_id,
        receiverName,
        receiverUpi: RECEIVER_UPI,
        expectedPayerName,
        senderPolicy: SENDER_NAME_POLICY,
      },
      serverTime: new Date(),
      timeoutMs: OCR_VERIFICATION_BUDGET_MS,
    });

    // Inconclusive outcome (OCR timeout / OCR failure / infrastructure
    // error): never a decision. The top-up keeps its submittable status so
    // the user can retry — it is never locked into a terminal state.
    if (engineResult.inconclusive) {
      await logAction(userId, 'user', 'submit_topup_proof', topupId, 'topup', { filename, error: engineResult.reason });
      await recordVerificationAttempt({
        referenceType: 'topup',
        referenceId: topupId,
        engine: 'paymentValidationEngine/v1',
        status: 'PENDING_VERIFICATION',
        decision: null,
        reasonCode: engineResult.reason || null,
        checks: engineResult.checks || null,
        extractedData: engineResult.extractedData || null,
        ocrConfidence: engineResult.ocrConfidence ?? null,
        transactionId: engineResult.transactionId || null,
        actorId: userId,
        actorRole: 'user',
      });
      throw {
        message: engineResult.message || 'Screenshot verification did not complete',
        code: engineResult.code || engineResult.reason || 'OCR_FAILED',
        reason: engineResult.reason || null,
        details: engineResult.details || null,
      };
    }

    // Provider verification (Rule F): when a provider integration is
    // configured, an engine-approved screenshot is confirmed independently
    // before any credit. Timeout / error / not-found fails safe to
    // manual_review with status PENDING_VERIFICATION.
    let providerResult = null;
    if (engineResult.approved && !engineResult.review && getProviderMode() !== 'none') {
      providerResult = await verifyTransaction({
        transactionId: engineResult.transactionId,
        amount: engineResult.matchedAmount,
        receiverUpi: RECEIVER_UPI,
      });
    }

    // Definitive/review outcome: hand the SAME decision to the shared top-up
    // persistence path (guarded status transition, expiry re-check, atomic
    // UTR reservation, wallet credit with rollback).
    //
    //   - engine review (e.g. payer-name mismatch)   -> manual_review park
    //   - provider not confirmed                     -> PENDING_VERIFICATION park
    //   - engine approved + PAYMENT_AUTO_APPROVE off -> EXTERNAL_PAYMENT_CONFIRMATION_REQUIRED park
    //   - engine approved + auto-approve on          -> completed (+credit)
    //   - engine rejected                            -> rejected
    const autoApprove = isPaymentAutoApproveEnabled();
    let verificationResult;
    let reason;
    if (engineResult.review === true) {
      reason = engineResult.reason || 'MANUAL_REVIEW';
      verificationResult = {
        ...engineResult,
        decision: 'manual_review',
        status: 'MANUAL_REVIEW',
        reason,
        utr: engineResult.transactionId || null,
        engine: 'paymentValidationEngine/v1',
      };
    } else if (engineResult.approved && providerResult && providerResult.verified !== true) {
      reason = 'PENDING_PROVIDER_VERIFICATION';
      verificationResult = {
        ...engineResult,
        decision: 'manual_review',
        status: 'PENDING_VERIFICATION',
        reason,
        provider: providerResult,
        utr: engineResult.transactionId || null,
        engine: 'paymentValidationEngine/v1',
      };
    } else if (engineResult.approved && !autoApprove) {
      reason = 'EXTERNAL_PAYMENT_CONFIRMATION_REQUIRED';
      verificationResult = requireExternalPaymentConfirmation({
        ...engineResult,
        decision: 'approved',
        reason,
        provider: providerResult,
        utr: engineResult.transactionId || null,
        engine: 'paymentValidationEngine/v1',
      });
    } else {
      reason = engineResult.approved
        ? null
        : (engineResult.reason === 'DUPLICATE_TRANSACTION' ? 'DUPLICATE_UTR' : (engineResult.reason || 'REJECTED'));
      verificationResult = {
        ...engineResult,
        decision: engineResult.approved ? 'approved' : 'rejected',
        status: engineResult.approved ? 'APPROVED' : 'REJECTED',
        reason,
        provider: providerResult,
        utr: engineResult.approved ? engineResult.transactionId : (engineResult.transactionId || null),
        engine: 'paymentValidationEngine/v1',
      };
    }
    outcome = await applyTopupVerification(topup, verificationResult, new Date());

    await logAction(userId, 'user', 'submit_topup_proof', topupId, 'topup', {
      filename,
      decision: verificationResult.decision,
      reason: verificationResult.reason,
      utr: engineResult.transactionId || null,
      engine: 'paymentValidationEngine/v1',
      timings: engineResult.timings || null,
      credited: outcome.credited || false,
    });

    await recordVerificationAttempt({
      referenceType: 'topup',
      referenceId: topupId,
      engine: 'paymentValidationEngine/v1',
      status: verificationResult.status || deriveOutcomeStatus(
        outcome.manualReview ? 'manual_review' : (outcome.credited ? 'approved' : 'rejected'),
        verificationResult,
      ),
      decision: verificationResult.decision,
      reasonCode: verificationResult.reason || null,
      checks: engineResult.checks || null,
      extractedData: engineResult.extractedData || null,
      ocrConfidence: engineResult.ocrConfidence ?? null,
      transactionId: engineResult.transactionId || null,
      provider: providerResult,
      actorId: userId,
      actorRole: 'user',
    });
  } catch (error) {
    // If the topup cannot be auto-verified (OCR failure / OCR timeout) it
    // must STAY submittable so the user can retry — never lock it into a
    // terminal state. An OCR timeout is INCONCLUSIVE, never an approval.
    if (error.code === 'OCR_FAILED' || error.code === 'OCR_UNREADABLE' || error.code === 'OCR_TIMEOUT') {
      throw error;
    }
    throw error;
  }

  return {
    message: outcome.credited
      ? 'Topup approved and amount credited to your balance'
      : outcome.manualReview
        ? 'Topup submitted for manual review. An administrator will verify it shortly.'
        : outcome.reason === 'DUPLICATE_UTR'
          ? 'Topup rejected: duplicate UTR detected'
          : outcome.reason
            ? `Topup rejected: ${topupRejectionMessage(outcome.reason)}`
            : 'Topup rejected',
    topupId,
    credited: outcome.credited || false,
    manualReview: outcome.manualReview || false,
    inconclusive: outcome.inconclusive || false,
    reason: outcome.reason || null,
    outcome: outcome.credited ? 'APPROVED'
      : outcome.manualReview
        ? (outcome.reason === 'PENDING_PROVIDER_VERIFICATION' ? 'PENDING_VERIFICATION' : 'MANUAL_REVIEW')
        : 'REJECTED',
  };
}

// User-facing explanation for a rejected top-up. Internal reason codes are
// translated here so the frontend never has to interpret them, and the raw
// codes stay server-side.
function topupRejectionMessage(reason) {
  switch (reason) {
    case 'AMOUNT_MISMATCH':
      return 'the screenshot amount does not match the top-up amount';
    case 'AMOUNT_NOT_DETECTED':
      return 'we could not read the amount from your screenshot';
    case 'UPI_MISMATCH':
      return 'the screenshot shows a different recipient';
    case 'RECEIVER_NAME_MISMATCH':
      return 'the screenshot shows a different recipient name';
    case 'RECEIVER_NAME_INCOMPLETE':
      return 'the recipient name in the screenshot is only partially visible';
    case 'INVALID_PAYMENT_DATE':
      return 'the screenshot is too old or its date could not be read';
    case 'PAYMENT_DATE_NOT_DETECTED':
      return 'we could not read the payment date from your screenshot';
    case 'PAYMENT_TIME_NOT_DETECTED':
      return 'we could not read the payment time from your screenshot';
    case 'TRANSACTION_FAILED':
      return 'the screenshot shows a failed or pending transaction';
    case 'MISSING_UTR':
      return 'no transaction ID was found in the screenshot';
    case 'LOW_OCR_CONFIDENCE':
      return 'the screenshot was not clear enough to verify';
    case 'LOW_FIELD_CONFIDENCE':
      return 'we could not read every detail of the payment with enough confidence';
    case 'PAYMENT_EXPIRED':
      return 'the 30-minute payment window has ended';
    case 'DEMO_SCREENSHOT':
      return 'sample or demo screenshots are not accepted';
    default:
      return 'the payment could not be verified';
  }
}

// ─────────────────────────────────────────────────────────────
// Applies the OCR verification decision to a top-up record.
//
// Idempotency for the balance credit is enforced by the top-up RECORD
// STATUS (an atomic guarded UPDATE), with wallet-level idempotency as a
// database backstop:
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
      const { data: current } = await supabase.from('topups')
        .select('status')
        .eq('id', topup.id)
        .single();
      if (current?.status !== 'completed') {
        return { credited: false, alreadyProcessed: true };
      }
      const credits = await creditTopupWallets(topup);
      return { credited: credits.some(result => result.credited), alreadyProcessed: true };
    }

    // ── Payment expiry gate (post-OCR, pre-commit) ──
    // Re-check the server window AFTER the (slow) OCR run, BEFORE the UTR
    // reservation and wallet credit. An approval that expired mid-OCR must
    // revert to rejected — never credited, never left completed.
    // NOTE: expires_at is server-set and IMMUTABLE for the life of the
    // request (set at creation, never updated), so the already-fetched
    // record carries the authoritative value — no re-read needed.
    if (isPaymentExpired(topup)) {
      await supabase
        .from('topups')
        .update({
          status: 'rejected',
          rejection_reason: 'PAYMENT_EXPIRED',
          verified_at: verificationTime.toISOString(),
          verification_result: { ...verificationResult, decision: 'rejected', reason: 'PAYMENT_EXPIRED' },
        })
        .eq('id', topup.id)
        .eq('status', 'completed');
      return { credited: false, alreadyProcessed: false, reason: 'PAYMENT_EXPIRED' };
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

    let credits;
    try {
      credits = await creditTopupWallets(topup);
    } catch (creditError) {
      const { error: reviewError } = await supabase.from('topups')
        .update({
          status: 'manual_review',
          rejection_reason: 'WALLET_CREDIT_FAILED',
          verification_result: {
            ...verificationResult,
            decision: 'manual_review',
            reason: 'WALLET_CREDIT_FAILED',
          },
        })
        .eq('id', topup.id)
        .eq('status', 'completed');
      if (reviewError) {
        throw {
          message: 'Wallet credit failed and top-up could not be moved to manual review',
          code: 'TOPUP_CREDIT_RECOVERY_FAILED',
          cause: creditError,
        };
      }
      if (verificationUtr) await releaseApprovedUtr(verificationUtr, 'topup', topup.id);
      throw creditError;
    }
    return { credited: credits.some(result => result.credited), alreadyProcessed: false, pendingClaim: false };
  }

  if (decision === 'manual_review') {
    // Expiry is authoritative: an expired request must never be parked for
    // review. Fail closed to a rejection instead.
    if (isPaymentExpired(topup)) {
      await supabase
        .from('topups')
        .update({
          status: 'rejected',
          rejection_reason: 'PAYMENT_EXPIRED',
          verified_at: verificationTime.toISOString(),
          verification_result: { ...verificationResult, decision: 'rejected', reason: 'PAYMENT_EXPIRED' },
        })
        .eq('id', topup.id)
        .in('status', SUBMITTABLE_STATUSES);
      return { credited: false, alreadyProcessed: false, reason: 'PAYMENT_EXPIRED' };
    }

    // Non-terminal outcome: the row is flagged for a human. No wallet credit,
    // no terminal 'rejected', and the status stays resubmittable/actionable by
    // an admin (topups.admin verify accepts 'manual_review').
    const { error } = await supabase
      .from('topups')
      .update({
        status: 'manual_review',
        rejection_reason: reason || 'MANUAL_REVIEW',
        verified_at: verificationTime.toISOString(),
        verification_result: verificationResult,
      })
      .eq('id', topup.id)
      .in('status', SUBMITTABLE_STATUSES);
    if (error) throw { message: 'Failed to flag topup for review', code: 'REVIEW_FAILED' };

    // An inconclusive reason means the screenshot could not be READ, not that
    // it was wrong. The frontend tells the user to resubmit instead of
    // reporting a rejection.
    const INCONCLUSIVE_REASONS = new Set([
      'AMOUNT_NOT_DETECTED',
      'PAYMENT_DATE_NOT_DETECTED',
      'PAYMENT_TIME_NOT_DETECTED',
      'RECEIVER_NAME_UNREADABLE',
      'RECEIVER_NAME_INCOMPLETE',
      'RECEIVER_NAME_NOT_CONFIGURED',
    ]);

    return {
      credited: false,
      alreadyProcessed: false,
      manualReview: true,
      inconclusive: INCONCLUSIVE_REASONS.has(reason),
      reason: reason || 'MANUAL_REVIEW',
    };
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

  return { credited: false, alreadyProcessed: false, reason: reason || 'REJECTED' };
}

async function creditTopupWallets(topup) {
  return walletService.creditBatch([
    {
      userId: topup.sender_id,
      amount: topup.amount,
      description: 'Top-up payment verified',
      referenceId: topup.id,
      referenceType: 'topup',
    },
    {
      userId: topup.receiver_id,
      amount: topup.amount,
      description: 'Top-up completed',
      referenceId: topup.id,
      referenceType: 'topup',
    },
  ]);
}

export async function verifyTopup(topupId, adminId, approved, reason) {
  const { data: topup, error: fetchError } = await supabase.from('topups').select('*').eq('id', topupId).single();
  if (fetchError || !topup) throw { message: 'Topup not found', code: 'TOPUP_NOT_FOUND' };
  if (topup.status === 'completed' && topup.verification_result?.adminReview?.decision === 'approved') {
    const credits = await creditTopupWallets(topup);
    return {
      message: 'Top-up already approved',
      topupId,
      credited: credits.some(result => result.credited),
      alreadyProcessed: true,
    };
  }
  if (topup.status !== 'manual_review') {
    throw { message: 'Top-up is not awaiting manual review', code: 'TOPUP_NOT_VERIFIABLE' };
  }

  if (approved) {
    if (!topup.screenshot_url) throw { message: 'Top-up proof is required for approval', code: 'TOPUP_PROOF_REQUIRED' };

    const verification = topup.verification_result || {};
    const requiredChecks = ['amount', 'receiverUpi', 'transactionDate', 'utr'];
    if (requiredChecks.some(key => verification.checks?.[key]?.passed !== true)) {
      throw { message: 'Required OCR fields are incomplete; top-up cannot be approved', code: 'TOPUP_VERIFICATION_INCOMPLETE' };
    }

    const utr = normalizeUtr(verification.utr || verification.detected?.utr);
    if (!utr) throw { message: 'A verified transaction reference is required', code: 'TOPUP_UTR_REQUIRED' };

    const reserve = await reserveApprovedUtr(utr, 'topup', topup.id);
    let reservedHere = reserve.reserved;
    if (reserve.duplicate) {
      const { data: existing, error } = await supabase.from('approved_utrs')
        .select('reference_type, reference_id')
        .eq('utr', utr)
        .maybeSingle();
      if (error) throw { message: 'Failed to check the transaction reference', code: 'UTR_LOOKUP_FAILED' };
      if (existing?.reference_type !== 'topup' || existing?.reference_id !== topup.id) {
        throw { message: 'Duplicate transaction reference', code: 'DUPLICATE_UTR' };
      }
    }

    const reviewedAt = new Date().toISOString();
    const reviewedResult = {
      ...verification,
      decision: 'approved',
      reason: null,
      adminReview: { decision: 'approved', adminId, utr, reviewedAt },
    };
    const { data: approvedRows, error } = await supabase.from('topups')
      .update({
        status: 'completed',
        completed_at: reviewedAt,
        verified_at: reviewedAt,
        verification_result: reviewedResult,
      })
      .eq('id', topupId)
      .eq('status', 'manual_review')
      .select('id');
    if (error) {
      if (reservedHere) await releaseApprovedUtr(utr, 'topup', topupId);
      throw { message: 'Failed to approve top-up', code: 'VERIFY_FAILED' };
    }

    if (!approvedRows || approvedRows.length === 0) {
      if (reservedHere) await releaseApprovedUtr(utr, 'topup', topupId);
      const { data: current } = await supabase.from('topups')
        .select('status, verification_result')
        .eq('id', topupId)
        .single();
      if (current?.status === 'completed' && current.verification_result?.adminReview?.decision === 'approved') {
        const credits = await creditTopupWallets(topup);
        return {
          message: 'Top-up already approved',
          topupId,
          credited: credits.some(result => result.credited),
          alreadyProcessed: true,
        };
      }
      throw { message: 'Top-up is no longer awaiting review', code: 'TOPUP_NOT_VERIFIABLE' };
    }

    let credits;
    try {
      credits = await creditTopupWallets(topup);
    } catch (creditError) {
      const { error: recoveryError } = await supabase.from('topups')
        .update({
          status: 'manual_review',
          rejection_reason: 'WALLET_CREDIT_FAILED',
          verification_result: { ...reviewedResult, decision: 'manual_review', reason: 'WALLET_CREDIT_FAILED' },
        })
        .eq('id', topupId)
        .eq('status', 'completed');
      if (recoveryError) {
        throw {
          message: 'Wallet credit failed and top-up could not be moved to manual review',
          code: 'TOPUP_CREDIT_RECOVERY_FAILED',
          cause: creditError,
        };
      }
      throw creditError;
    }

    const { error: receiverError } = await supabase.from('users').update({
      status: 'inactive', inactive_reason: 'inactive_due_to_referral_condition', inactive_since: new Date().toISOString()
    }).eq('id', topup.receiver_id);
    if (receiverError) throw { message: 'Failed to update receiver status', code: 'RECEIVER_UPDATE_FAILED' };

    await logAction(adminId, 'admin', 'approve_topup', topupId, 'topup', {
      senderId: topup.sender_id,
      receiverId: topup.receiver_id,
      amount: topup.amount,
      utr,
    });
    return { message: 'Top-up approved and credited', topupId, credited: credits.some(result => result.credited) };
  }

  const { data: rejectedRows, error } = await supabase.from('topups')
    .update({
      status: 'rejected',
      rejection_reason: reason || 'Admin rejected after review',
      verified_at: new Date().toISOString(),
    })
    .eq('id', topupId)
    .eq('status', 'manual_review')
    .select('id');
  if (error) throw { message: 'Failed to reject top-up', code: 'REJECT_FAILED' };
  if (!rejectedRows || rejectedRows.length === 0) {
    throw { message: 'Top-up is no longer awaiting review', code: 'TOPUP_NOT_VERIFIABLE' };
  }

  await logAction(adminId, 'admin', 'reject_topup', topupId, 'topup', {
    senderId: topup.sender_id,
    receiverId: topup.receiver_id,
    reason: reason || null,
  });
  return { message: 'Top-up rejected', topupId };
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
  // Legacy manual_review rows are never exposed to the frontend.
  for (const t of [...(sent || []), ...(received || [])]) {
    if (t.status === 'manual_review') t.status = 'pending';
  }
  return { sent: sent || [], received: received || [] };
}

export async function getTopupDetails(topupId) {
  const { data: topup, error } = await supabase.from('topups')
    .select('*, sender:users!topups_sender_id_fkey(id, full_name, email), receiver:users!topups_receiver_id_fkey(id, full_name, email)')
    .eq('id', topupId).single();
  if (error || !topup) throw { message: 'Topup not found', code: 'TOPUP_NOT_FOUND' };
  if (topup.status === 'manual_review') topup.status = 'pending';
  return topup;
}

// ─────────────────────────────────────────────────────────────
// Authenticated top-up proof streaming — access-controlled evidence access
// (owner sender / receiver / admin only). Mirrors the registration
// payment screenshot proxy.
// ─────────────────────────────────────────────────────────────
function storageObjectPathFromUrl(url) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/');
    const bucketIdx = segments.indexOf('payments');
    return bucketIdx >= 0 ? segments.slice(bucketIdx + 1).join('/') : null;
  } catch {
    return null;
  }
}

export async function streamTopupScreenshot(topupId, requester) {
  const { data: topup, error } = await supabase.from('topups')
    .select('sender_id, receiver_id, screenshot_url')
    .eq('id', topupId)
    .single();
  if (error || !topup) throw { message: 'Topup not found', code: 'TOPUP_NOT_FOUND' };
  const allowed = requester?.role === 'admin'
    || topup.sender_id === requester?.id
    || topup.receiver_id === requester?.id;
  if (!allowed) throw { message: 'Unauthorized', code: 'UNAUTHORIZED' };
  if (!topup.screenshot_url) throw { message: 'No proof uploaded', code: 'NO_SCREENSHOT' };
  const objectPath = storageObjectPathFromUrl(topup.screenshot_url);
  if (!objectPath) throw { message: 'Proof not available', code: 'SCREENSHOT_UNAVAILABLE' };
  const { data: file, error: dlError } = await supabase.storage.from('payments').download(objectPath);
  if (dlError || !file) throw { message: 'Proof not available', code: 'SCREENSHOT_UNAVAILABLE' };
  const buffer = Buffer.from(await file.arrayBuffer());
  return { buffer, contentType: file.type || 'image/png' };
}
