import { useState, useEffect } from 'react';
import { CreditCard, Eye, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import StatusBadge from '../../components/StatusBadge';
import Modal from '../../components/Modal';
import EmptyState from '../../components/EmptyState';
import LoadingSpinner from '../../components/LoadingSpinner';
import PaymentScreenshot from '../../components/PaymentScreenshot';
import PageHeader from '../../components/PageHeader';

const OUTCOME_HELP = {
  APPROVED: 'Your payment has been verified.',
  REJECTED: 'This payment did not pass verification.',
  PENDING_VERIFICATION: 'Verification is in progress or awaiting confirmation. No action needed yet.',
  MANUAL_REVIEW: 'This payment needs a manual review by our team.',
};

function friendlyReason(code) {
  const map = {
    EXTERNAL_PAYMENT_CONFIRMATION_REQUIRED: 'Your screenshot passed automated checks and is awaiting final confirmation.',
    PENDING_PROVIDER_VERIFICATION: 'Your payment could not be confirmed with the payment provider yet — it stays pending.',
    SENDER_NAME_MISMATCH: 'The payer name on the screenshot did not match your name — an administrator will review it.',
    DUPLICATE_UTR: 'This transaction reference has already been used for another payment.',
    DUPLICATE_TRANSACTION: 'This transaction reference has already been used for another payment.',
    AMOUNT_MISMATCH: 'The amount on the screenshot did not match the expected amount.',
    AMOUNT_NOT_DETECTED: 'We could not read the amount from your screenshot.',
    CONFLICTING_AMOUNTS: 'We found conflicting amounts on your screenshot.',
    UPI_MISMATCH: 'The receiver UPI on the screenshot did not match the expected recipient.',
    RECEIVER_NAME_MISMATCH: 'The recipient name on the screenshot did not match the expected recipient.',
    RECEIVER_NAME_INCOMPLETE: 'The recipient name on the screenshot is only partially visible.',
    RECEIVER_NAME_UNREADABLE: 'We could not read the recipient name from your screenshot.',
    RECEIVER_NAME_NOT_CONFIGURED: 'Your payment needs a manual review because the recipient name is not configured.',
    INVALID_PAYMENT_DATE: 'The transaction date/time on the screenshot is outside the allowed payment window.',
    TRANSACTION_TOO_OLD: 'The transaction on the screenshot is too old for this payment request.',
    FUTURE_TRANSACTION_TIMESTAMP: 'The transaction timestamp on the screenshot is in the future.',
    PAYMENT_EXPIRED: 'The 30-minute payment window had ended for this request.',
    TRANSACTION_FAILED: 'The screenshot shows a failed or pending transaction.',
    MISSING_UTR: 'No transaction reference was found on the screenshot.',
    LOW_OCR_CONFIDENCE: 'The screenshot was not clear enough to verify.',
    IMAGE_INTEGRITY_FAILED: 'The uploaded file is not a valid image.',
    OCR_TIMEOUT: 'Verification took too long — please upload the screenshot again.',
    OCR_UNREADABLE: 'We could not read the screenshot clearly enough.',
    DEMO_SCREENSHOT: 'Sample or demo screenshots are not accepted.',
  };
  return map[code] || null;
}

export default function PaymentStatus() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    api.get('/payments').then(r => setPayments(r.data.data || []) ).catch(() => toast.error('Failed to load payments')).finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner fullPage />;

  return (
    <div className="space-y-6">
      <PageHeader title="Payment Status" description="Your registration payment records" />
      {payments.length === 0 ? (
        <div className="table-shell">
          <EmptyState icon={<CreditCard className="h-6 w-6" />} title="No payments found" description="Your payment records will appear here after registration." />
        </div>
      ) : (
        <div className="space-y-4">
          {payments.map(p => (
            <div key={p.id} className="card flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  <span className="font-semibold text-ink">₹{p.expected_amount}</span>
                  <StatusBadge status={p.status} />
                  {p.outcome && p.outcome !== 'PENDING_VERIFICATION' && (
                    <span className="inline-flex items-center gap-1 text-xs text-ink-faint">
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      <StatusBadge status={p.outcome.toLowerCase()} size="sm" />
                    </span>
                  )}
                </div>
                {p.outcome && OUTCOME_HELP[p.outcome] && (
                  <p className="text-xs text-ink-muted mb-1">{OUTCOME_HELP[p.outcome]}</p>
                )}
                <p className="text-sm text-ink-muted">Plan: ₹{p.selected_plan} | Submitted: {new Date(p.submitted_at).toLocaleString()}</p>
                {p.verified_at && <p className="text-sm text-ink-muted">Verified: {new Date(p.verified_at).toLocaleString()}</p>}
                {p.transaction_id && <p className="text-xs text-ink-faint font-mono">UTR: {p.transaction_id}</p>}
                {(p.rejection_reason || p.verification_result?.reason) && (
                  <p className="text-sm text-error-600 dark:text-error-400 mt-1">
                    Reason: {friendlyReason(p.rejection_reason || p.verification_result?.reason) || p.rejection_reason || p.verification_result?.reason}
                  </p>
                )}
              </div>
              {p.screenshot_url && (
                <button onClick={() => setSelected(p)} className="btn btn-secondary btn-sm w-full sm:w-auto shrink-0"><Eye className="h-4 w-4" aria-hidden="true" /> View Screenshot</button>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={!!selected} onClose={() => setSelected(null)} title="Payment Screenshot" size="lg">
        {selected && (
          <PaymentScreenshot
            endpoint={`/payments/${selected.id}/screenshot`}
            alt="Payment screenshot"
            className="w-full rounded-lg border border-line"
          />
        )}
      </Modal>
    </div>
  );
}
