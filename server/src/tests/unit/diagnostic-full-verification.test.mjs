// Full verification diagnostic for production GPay case
// Run with: npx vitest run src/tests/unit/diagnostic-full-verification.test.mjs

import { describe, it, expect } from 'vitest';
import {
  extractUPIs,
  extractAmounts,
  extractUTRs,
  extractDateTimes,
  extractTransactionStatus,
  extractPaymentData,
  matchUPIWithRecovery,
  matchAmount,
  isSameIstDay,
  isWithinTimeWindow,
  dateTimeEntryToDate,
} from '../../services/ocrService.js';
import {
  decidePaymentVerification,
  runScreenshotVerification,
} from '../../services/verificationService.js';

const RECEIVER_UPI = 'jayarajj126-3@okicici';

// Exact production GPay OCR text
const GPAY_OCR_TEXT = `Payment Successful
₹120
To Jayaraj
••••26-3@okicici
Completed
19/09/2026, 9:52 AM
UPI transaction ID
865128581
Google Pay`;

describe('FULL VERIFICATION DIAGNOSTIC: Production GPay case', () => {
  it('should trace every gate for the exact production case', () => {
    console.log('\n=== PRODUCTION GPay DIAGNOSTIC ===\n');
    
    // Step 1: OCR Extraction
    const extractedAmounts = extractAmounts(GPAY_OCR_TEXT);
    const extractedUPIs = extractUPIs(GPAY_OCR_TEXT);
    const extractedUTRs = extractUTRs(GPAY_OCR_TEXT);
    const extractedDateTimes = extractDateTimes(GPAY_OCR_TEXT);
    const transactionStatus = extractTransactionStatus(GPAY_OCR_TEXT);
    
    console.log('1. EXTRACTION:');
    console.log('   Amounts:', extractedAmounts);
    console.log('   UPIs:', extractedUPIs);
    console.log('   UTRs:', extractedUTRs);
    console.log('   DateTimes:', JSON.stringify(extractedDateTimes, null, 2));
    console.log('   Status:', transactionStatus);
    
    // Step 2: UPI Matching
    const upiResult = matchUPIWithRecovery(extractedUPIs, RECEIVER_UPI);
    const upiMatch = upiResult.match;
    
    console.log('\n2. UPI MATCHING:');
    console.log('   upiMatch:', upiMatch);
    console.log('   matchMethod:', upiResult.method);
    console.log('   matchConfidence:', upiResult.confidence);
    console.log('   matchedCandidate:', upiResult.candidate);
    console.log('   allCandidates:', upiResult.allCandidates);
    
    // Step 3: Amount Matching
    const amountMatch = matchAmount(extractedAmounts, 120);
    console.log('\n3. AMOUNT MATCHING:');
    console.log('   amountMatch:', amountMatch);
    console.log('   expected: 120, extracted:', extractedAmounts);
    
    // Step 4: UTR Validation
    const utr = extractedUTRs.length > 0 ? extractedUTRs[0]?.replace(/\s+/g, '').trim() || null : null;
    const utrPresent = !!utr;
    console.log('\n4. UTR VALIDATION:');
    console.log('   utr:', utr);
    console.log('   utrPresent:', utrPresent);
    
    // Step 5: Date/Time Validation
    const timeEntry = extractedDateTimes.find(e => e.hasTime) || null;
    const anyEntry = extractedDateTimes[0] || null;
    const dateEntry = timeEntry || anyEntry;
    const date = dateEntry ? dateTimeEntryToDate(dateEntry) : null;
    const hasTimeComponent = !!(timeEntry || anyEntry)?.hasTime;
    
    console.log('\n5. DATE/TIME VALIDATION:');
    console.log('   dateEntry:', dateEntry);
    console.log('   parsed date:', date);
    console.log('   hasTimeComponent:', hasTimeComponent);
    
    // Use a server time that matches the payment (19 Sep 2026, 9:52 AM IST = 04:22 UTC)
    const mockNow = new Date('2026-09-19T04:22:00.000Z');
    console.log('   mock server time (UTC):', mockNow.toISOString());
    console.log('   mock server time (IST):', new Date(mockNow.getTime() + 5.5 * 60 * 60 * 1000).toISOString());
    
    const dateValid = !!date && isSameIstDay(date, mockNow) && isWithinTimeWindow(date, mockNow, 30);
    console.log('   isSameIstDay:', !!date && isSameIstDay(date, mockNow));
    console.log('   isWithinTimeWindow:', !!date && isWithinTimeWindow(date, mockNow, 30));
    console.log('   dateValid:', dateValid);
    
    // Step 6: Status Validation
    const transactionStatusOk = transactionStatus?.status === 'success';
    console.log('\n6. STATUS VALIDATION:');
    console.log('   transactionStatusOk:', transactionStatusOk);
    console.log('   status:', transactionStatus);
    
    // Step 7: OCR Confidence
    const ocrConfidence = 75;
    const MIN_OCR_CONFIDENCE_APPROVE = 55;
    const ocrConfident = ocrConfidence !== undefined && ocrConfidence >= MIN_OCR_CONFIDENCE_APPROVE;
    console.log('\n7. OCR CONFIDENCE:');
    console.log('   ocrConfidence:', ocrConfidence);
    console.log('   MIN_OCR_CONFIDENCE_APPROVE:', MIN_OCR_CONFIDENCE_APPROVE);
    console.log('   ocrConfident:', ocrConfident);
    
    // Step 8: Field Confidence
    const detectedUpi = extractedUPIs.length > 0 ? extractedUPIs.join(', ') : null;
    
    const fieldConfidence = {
      amount: {
        confidence: amountMatch ? 'high' : (extractedAmounts.length > 0 ? 'low' : 'none'),
        reason: amountMatch ? 'Extracted amount matches expected' : '...',
      },
      receiverUpi: {
        confidence: upiMatch ? 'high' : (extractedUPIs.length > 0 ? 'low' : 'none'),
        reason: upiMatch ? 'Receiver UPI matches expected' : '...',
      },
      utr: {
        confidence: utr ? 'high' : 'none',
        reason: utr ? `UTR found: ${utr}` : 'No UTR found in screenshot',
      },
      transactionDate: {
        confidence: hasTimeComponent ? 'high' : (date ? 'medium' : 'none'),
        reason: dateValid ? 'Date/time within forward window' : '...',
      },
      transactionStatus: {
        confidence: transactionStatusOk ? 'high' : (transactionStatus ? 'low' : 'none'),
        reason: transactionStatusOk ? 'Status detected: success' : '...',
      },
    };
    
    console.log('\n8. FIELD CONFIDENCE:');
    console.log('   amount:', fieldConfidence.amount.confidence);
    console.log('   receiverUpi:', fieldConfidence.receiverUpi.confidence, '(upiMatch:', upiMatch, ')');
    console.log('   utr:', fieldConfidence.utr.confidence);
    console.log('   transactionDate:', fieldConfidence.transactionDate.confidence, '(hasTimeComponent:', hasTimeComponent, ')');
    console.log('   transactionStatus:', fieldConfidence.transactionStatus.confidence);
    
    const allFieldsHighConfidence =
      fieldConfidence.amount.confidence === 'high' &&
      fieldConfidence.receiverUpi.confidence === 'high' &&
      fieldConfidence.utr.confidence === 'high' &&
      fieldConfidence.transactionDate.confidence === 'high' &&
      fieldConfidence.transactionStatus.confidence === 'high';
    
    console.log('   allFieldsHighConfidence:', allFieldsHighConfidence);
    
    // Step 9: Decision Engine
    const decisionResult = decidePaymentVerification({
      upiMatch,
      amountMatch,
      dateValid,
      utrPresent,
      transactionStatusOk,
      ocrConfidence,
    });
    
    console.log('\n9. DECISION ENGINE:');
    console.log('   decision:', decisionResult.decision);
    console.log('   reason:', decisionResult.reason);
    
    // Step 10: Final Decision (with field confidence gate)
    let effectiveDecision = decisionResult.decision;
    let effectiveReason = decisionResult.reason;
    if (effectiveDecision === 'approved' && !allFieldsHighConfidence) {
      effectiveDecision = 'rejected';
      effectiveReason = 'LOW_FIELD_CONFIDENCE';
    }
    
    console.log('\n10. FINAL DECISION:');
    console.log('   effectiveDecision:', effectiveDecision);
    console.log('   effectiveReason:', effectiveReason);
    
    // Summary
    console.log('\n=== GATE SUMMARY ===');
    console.log('upiMatch:', upiMatch, '(method:', upiResult.method, ', confidence:', upiResult.confidence, ')');
    console.log('amountMatch:', amountMatch);
    console.log('dateValid:', dateValid);
    console.log('utrPresent:', utrPresent);
    console.log('transactionStatusOk:', transactionStatusOk);
    console.log('ocrConfident:', ocrConfident);
    console.log('allFieldsHighConfidence:', allFieldsHighConfidence);
    console.log('FINAL:', effectiveDecision, effectiveReason ? '(' + effectiveReason + ')' : '');
    
    // The test expects APPROVED
    expect(effectiveDecision).toBe('approved');
  });
});