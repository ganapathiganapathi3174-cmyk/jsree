import { useState, useEffect } from 'react';
import { ArrowUpDown, Upload, Eye, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import StatusBadge from '../../components/StatusBadge';
import Modal from '../../components/Modal';
import PaymentScreenshot from '../../components/PaymentScreenshot';
import EmptyState from '../../components/EmptyState';
import LoadingSpinner from '../../components/LoadingSpinner';
import QRPaymentSection from '../../components/QRPaymentSection';
import PageHeader from '../../components/PageHeader';

const PAY_AMOUNTS = [120, 500, 1000];

export default function TopUps() {
  const [topups, setTopups] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('received');
  const [proofModal, setProofModal] = useState(null);
  const [screenshotTopup, setScreenshotTopup] = useState(null);
  const [screenshot, setScreenshot] = useState(null);
  const [refId, setRefId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [payAmount, setPayAmount] = useState(120);
  const [payTarget, setPayTarget] = useState(null);
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  const userPlan = Number(user.current_plan);
  const planAmounts = PAY_AMOUNTS.includes(userPlan) ? [userPlan] : PAY_AMOUNTS;

  useEffect(() => {
    setPayAmount(PAY_AMOUNTS.includes(userPlan) ? userPlan : 120);
  }, []);

  const load = () => api.get('/topups').then(r => { setTopups(r.data.data || []); setSummary(r.data.summary || null); }).catch(() => toast.error('Failed to load top-ups')).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const received = topups.filter(t => t.receiver_id === user.id);
  const sent = topups.filter(t => t.sender_id === user.id);
  const list = tab === 'received' ? received : sent;
  const eligibleForProof = topups.filter(t => t.sender_id === user.id && ['created', 'payment_pending'].includes(t.status));

  // The server replies 200 for a verification that COMPLETED with a
  // rejection — surfacing that as a success toast would tell the user the
  // money was credited when it was refused. A verification parked for manual
  // review is neither credited nor rejected, so it gets an informational toast.
  // A verification that produced NO decision (OCR timeout / unreadable image)
  // is inconclusive: it is neither credited nor refused, and the record stays
  // resubmittable.
  const announceProofResult = (message, fallback, manualReview, inconclusive) => {
    const text = message || fallback;
    if (inconclusive) toast.error(text);
    else if (manualReview || /review/i.test(text)) toast(text, { icon: '\u23F3' });
    else if (/reject/i.test(text)) toast.error(text);
    else toast.success(text);
  };

  // A 504 OCR_TIMEOUT / 400 OCR_FAILED means no decision was reached. The
  // top-up is still pending and can be resubmitted — it was NOT rejected.
  const isInconclusiveError = (code) =>
    code === 'OCR_TIMEOUT' || code === 'OCR_FAILED' || code === 'OCR_UNREADABLE';

  const inconclusiveMessage = (code) =>
    code === 'OCR_TIMEOUT'
      ? 'Verification took too long to finish. Your top-up is still pending — please upload the screenshot again.'
      : 'We could not read your screenshot. Your top-up is still pending — please upload a clearer screenshot.';

  const handleProof = async () => {
    if (!screenshot) { toast.error('Upload screenshot'); return; }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('screenshot', screenshot);
      fd.append('reference_id', refId);
      const res = await api.post(`/topups/${proofModal.id}/proof`, fd);
      announceProofResult(res.data.message, 'Proof submitted!', res.data.data?.manualReview, res.data.data?.inconclusive);
      setProofModal(null); setScreenshot(null); setRefId('');
      load();
    } catch (err) {
      const code = err.response?.data?.code;
      const msg = err.response?.data?.message;
      if (isInconclusiveError(code)) {
        toast.error(inconclusiveMessage(code));
      } else if (code === 'REQUEST_TIMEOUT' || code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
        toast.error('Verification timed out. The server is taking too long (possibly a cold start). Please try again in a moment.');
      } else if (code === 'DUPLICATE_REQUEST') {
        toast.error('A verification for this screenshot is already in progress. Please wait for the result.');
      } else {
        toast.error(msg || 'Failed');
      }
    }
    finally { setSubmitting(false); }
  };

  const handleTopupVerify = async (file) => {
    const targets = eligibleForProof;
    setSubmitting(true);
    try {
      if (targets.length === 0) {
        const fd = new FormData();
        fd.append('screenshot', file);
        fd.append('amount', payAmount);
        if (summary?.sponsorId) fd.append('receiverId', summary.sponsorId);
        const res = await api.post('/topups/direct', fd);
        announceProofResult(res.data.message, 'Payment proof submitted!', res.data.data?.manualReview, res.data.data?.inconclusive);
      } else {
        const targetId = payTarget || targets[0].id;
        const fd = new FormData();
        fd.append('screenshot', file);
        const res = await api.post(`/topups/${targetId}/proof`, fd);
        announceProofResult(res.data.message, 'Payment proof submitted!', res.data.data?.manualReview, res.data.data?.inconclusive);
      }
      load();
    } catch (err) {
      const code = err.response?.data?.code;
      const msg = err.response?.data?.message;
      if (isInconclusiveError(code)) {
        toast.error(inconclusiveMessage(code));
      } else if (code === 'REQUEST_TIMEOUT' || code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
        toast.error('Verification timed out. The server is taking too long (possibly a cold start). Please try again in a moment.');
      } else if (code === 'DUPLICATE_REQUEST') {
        toast.error('A verification for this screenshot is already in progress. Please wait for the result.');
      } else {
        toast.error(msg || 'Failed to submit proof');
      }
    }
    finally { setSubmitting(false); }
  };

  const handlePayTargetChange = (value) => {
    const target = eligibleForProof.find(t => t.id === value);
    setPayTarget(value);
    if (target && PAY_AMOUNTS.includes(Number(target.amount))) setPayAmount(Number(target.amount));
  };

  if (loading) return <LoadingSpinner fullPage />;

  return (
    <div className="space-y-6">
      <PageHeader title="Top-Ups" description="Send and receive top-ups between members" />

      {summary && (
        <div className={`card flex flex-col sm:flex-row sm:items-center justify-between gap-4${summary.mustTopup ? ' border-2 border-warning-500/40' : ''}`}>
          <div className="min-w-0">
            <p className="text-sm text-ink-muted">
              Received top-ups: <span className="font-semibold text-ink">{summary.receivedCompletedCount}/{summary.receivedRequired}</span>
              {summary.remaining > 0 && <span className="text-ink-faint"> — {summary.remaining} more before you must top-up</span>}
            </p>
            {summary.receivedPendingCount > 0 && (
              <p className="text-xs text-ink-faint mt-1">
                {summary.canClaim
                  ? `${summary.receivedClaimableCount} top-up${summary.receivedClaimableCount !== 1 ? 's' : ''} ready to claim`
                  : `${summary.receivedPendingCount} top-up${summary.receivedPendingCount !== 1 ? 's' : ''} waiting — complete your required top-up to claim`
                }
              </p>
            )}
            <p className="text-xs text-ink-faint mt-1">
              {summary.sponsorName ? `Your sponsor: ${summary.sponsorName}` : 'Only completed top-ups count towards the total.'}
            </p>
          </div>
          {summary.mustTopup && (
            <span className="badge badge-warning shrink-0">Top-Up Required</span>
          )}
        </div>
      )}

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-ink">Top-Up Payment</h3>
          <span className="badge badge-info">UPI</span>
        </div>
        <p className="text-sm text-ink-muted mb-4">Select the amount, pay the JSREE UPI, then upload your payment screenshot for verification.</p>
        {eligibleForProof.length > 0 && (
          <div className="mb-4">
            <label htmlFor="topup-pending-target" className="label">Attach screenshot to Pending Top-Up</label>
            <select
              id="topup-pending-target"
              value={payTarget || eligibleForProof[0]?.id}
              onChange={(e) => handlePayTargetChange(e.target.value)}
              className="input-field"
            >
              {eligibleForProof.map(t => (
                <option key={t.id} value={t.id}>
                  ₹{t.amount} — {t.receiver_name || t.receiver_id?.slice(0, 8)} ({t.status})
                </option>
              ))}
            </select>
          </div>
        )}
        <QRPaymentSection
          amount={payAmount}
          onAmountChange={(amt) => { setPayAmount(amt); if (eligibleForProof.length > 0 && !payTarget) setPayTarget(eligibleForProof[0].id); }}
          amountOptions={planAmounts}
          verifyLabel="Verify Payment"
          verifySubmitting={submitting}
          onVerify={handleTopupVerify}
        />
        {eligibleForProof.length === 0 && (
          <p className="callout callout-info mt-3">
            Make the payment above using the QR, then upload your screenshot. It will be verified and recorded as a top-up to your sponsor — no prior request is needed.
          </p>
        )}
      </div>

      <div className="flex gap-2" role="group" aria-label="Filter top-ups">
        <button onClick={() => setTab('received')} aria-pressed={tab === 'received'} className={`chip${tab === 'received' ? ' chip-active' : ''}`}>Received ({received.length})</button>
        <button onClick={() => setTab('sent')} aria-pressed={tab === 'sent'} className={`chip${tab === 'sent' ? ' chip-active' : ''}`}>Sent ({sent.length})</button>
      </div>

      {list.length === 0 ? (
        <div className="table-shell">
          <EmptyState icon={<ArrowUpDown className="h-6 w-6" />} title="No top-ups" description={`No ${tab} top-ups found.`} />
        </div>
      ) : (
        <div className="space-y-3">
          {list.map(t => {
            const isReceiver = t.receiver_id === user.id;
            const isCompleted = t.status === 'completed';

            return (
              <div key={t.id} className="card flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-semibold text-ink">₹{t.amount}</span>
                    <StatusBadge status={t.status} />
                    {isCompleted && (
                      <span className="badge badge-success">
                        <CheckCircle className="h-3 w-3" aria-hidden="true" />
                        {isReceiver ? 'Credited' : 'Completed'}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-ink-muted">{isReceiver ? `From: ${t.sender?.full_name || t.sender?.email || t.sender_id?.slice(0, 8)}` : `To: ${t.receiver?.full_name || t.receiver?.email || t.receiver_id?.slice(0, 8)}`}</p>
                  <p className="text-xs text-ink-faint">{new Date(t.created_at).toLocaleString()}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  {t.screenshot_url && (
                    <button onClick={() => setScreenshotTopup(t)} className="btn btn-secondary btn-sm"><Eye className="h-4 w-4" aria-hidden="true" /> Screenshot</button>
                  )}
                  {tab === 'received' && t.status === 'payment_pending' && (
                    <button onClick={() => setProofModal(t)} className="btn btn-primary btn-sm"><Upload className="h-4 w-4" aria-hidden="true" /> Submit Proof</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal isOpen={!!proofModal} onClose={() => setProofModal(null)} title="Submit Payment Proof">
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">Upload your payment screenshot for ₹{proofModal?.amount}</p>
          {proofModal?.expires_at && (
            <p className="callout callout-warning">
              This top-up request expires at {new Date(proofModal.expires_at).toLocaleString()}. Expired requests are rejected automatically — the server clock decides, not this display.
            </p>
          )}
          <div>
            <label htmlFor="topup-proof-file" className="label">Payment Screenshot</label>
            <input id="topup-proof-file" type="file" accept="image/*" className="input-field" onChange={e => setScreenshot(e.target.files[0])} />
          </div>
          <div>
            <label htmlFor="topup-proof-ref" className="label">Transaction/Reference ID</label>
            <input id="topup-proof-ref" className="input-field" placeholder="Transaction/Reference ID" value={refId} onChange={e => setRefId(e.target.value)} />
          </div>
          <button onClick={handleProof} disabled={submitting} className="btn btn-primary w-full">{submitting ? 'Submitting...' : 'Submit Proof'}</button>
        </div>
      </Modal>

      <Modal isOpen={!!screenshotTopup} onClose={() => setScreenshotTopup(null)} title="Payment Screenshot" size="lg">
        {screenshotTopup && (
          <PaymentScreenshot
            endpoint={`/topups/${screenshotTopup.id}/proof`}
            alt="Top-up payment screenshot"
            className="w-full rounded-lg border border-line"
          />
        )}
      </Modal>
    </div>
  );
}
