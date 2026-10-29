import { useState, useEffect, useCallback } from 'react';
import { Eye, CheckCircle, XCircle, Trash2, UserX, CreditCard, Search, Filter, History, ShieldCheck, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import StatusBadge from '../../components/StatusBadge';
import Modal from '../../components/Modal';
import ConfirmDialog from '../../components/ConfirmDialog';
import LoadingSpinner from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import PaymentScreenshot from '../../components/PaymentScreenshot';
import PageHeader from '../../components/PageHeader';

const OUTCOME_LABELS = {
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  PENDING_VERIFICATION: 'Pending verification',
  MANUAL_REVIEW: 'Manual review',
};

function friendlyReason(code) {
  const map = {
    EXTERNAL_PAYMENT_CONFIRMATION_REQUIRED: 'Screenshot verified — awaiting provider/human confirmation',
    PENDING_PROVIDER_VERIFICATION: 'Provider confirmation unavailable/pending',
    SENDER_NAME_MISMATCH: 'Payer name mismatch — needs human review',
    DUPLICATE_UTR: 'Transaction reference already used',
    AMOUNT_MISMATCH: 'Amount does not match expected',
    UPI_MISMATCH: 'Paid to a different UPI ID',
    RECEIVER_NAME_MISMATCH: 'Recipient name mismatch',
    PAYMENT_EXPIRED: 'Payment window expired',
    TRANSACTION_FAILED: 'Transaction not marked completed',
    MISSING_UTR: 'No transaction reference found',
    DEMO_SCREENSHOT: 'Demo/sample screenshot detected',
  };
  return map[code] || code || null;
}

function CheckRow({ label, check }) {
  if (!check) return null;
  const passed = check.passed === true;
  const indeterminate = check.passed === null || check.passed === undefined;
  const color = passed ? 'text-success-600' : indeterminate ? 'text-warning-600' : 'text-error-600';
  const mark = passed ? 'PASS' : indeterminate ? 'N/A' : 'FAIL';
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-line last:border-0">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="text-xs font-semibold shrink-0">
        <span className={color}>{mark}</span>
        {check.reason && !passed && <span className="ml-2 text-ink-faint font-normal">{check.reason}</span>}
        {check.method && passed && <span className="ml-2 text-ink-faint font-normal">{check.method}</span>}
      </span>
    </div>
  );
}

const EMPTY_FILTERS = { status: '', type: '', from: '', to: '', search: '' };

export default function AdminPayments() {
  const [payments, setPayments] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [detail, setDetail] = useState(null);       // list row (quick view)
  const [detailFull, setDetailFull] = useState(null); // fetched detail + history
  const [detailLoading, setDetailLoading] = useState(false);
  const [reviewReason, setReviewReason] = useState('');
  const [reviewAction, setReviewAction] = useState(null); // 'approve' | 'reject'
  const [confirmAction, setConfirmAction] = useState(null);

  const load = useCallback((f = filters) => {
    setLoading(true);
    const params = {};
    Object.entries(f).forEach(([k, v]) => { if (v) params[k] = v; });
    api.get('/admin/payments', { params })
      .then(r => {
        setPayments(r.data.data || []);
        setSummary(r.data.summary || null);
      })
      .catch(() => toast.error('Failed to load payments'))
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openDetail = (p) => {
    setDetail(p);
    setDetailFull(null);
    setReviewReason('');
    setReviewAction(null);
    setDetailLoading(true);
    api.get(`/admin/payments/${p.id}`)
      .then(r => setDetailFull(r.data.data))
      .catch(() => toast.error('Failed to load payment details'))
      .finally(() => setDetailLoading(false));
  };

  const submitReview = async () => {
    if (!reviewAction) return;
    if (!reviewReason.trim() || reviewReason.trim().length < 3) {
      toast.error('A recorded reason is required (min 3 characters)');
      return;
    }
    try {
      await api.post(`/admin/payments/${detail.id}/review`, {
        action: reviewAction,
        reason: reviewReason.trim(),
      });
      toast.success(reviewAction === 'approve' ? 'Payment approved (manual review resolved)' : 'Payment rejected');
      setDetail(null);
      setReviewAction(null);
      setReviewReason('');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to resolve review');
    }
  };

  const handleDeleteUser = async (userId) => {
    try { await api.delete(`/admin/users/${userId}?soft=true`); toast.success('User disabled (soft deleted)'); setConfirmAction(null); load(); }
    catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
  };
  const handleDeletePayment = async (paymentId) => {
    try {
      const res = await api.delete(`/admin/payments/${paymentId}`);
      toast.success(res.data.message || 'Registration deleted');
      setConfirmAction(null);
      load();
    } catch (err) {
      const code = err.response?.data?.code;
      if (code === 'FINANCIAL_HISTORY_EXISTS') {
        toast.error('This account contains financial records and cannot be permanently deleted. Use the approved retention/soft-delete process.');
      } else {
        toast.error(err.response?.data?.message || 'Failed to delete registration');
      }
    }
  };

  const checks = detailFull?.verification_result?.checks || detail?.verification_result?.checks || null;
  const extracted = detailFull?.verification_result?.extractedData || null;
  const history = detailFull?.verificationHistory || [];
  const outcome = detailFull?.outcome || null;
  const actionable = ['pending', 'manual_review'].includes(detail?.status);

  if (loading && payments.length === 0 && !summary) return <LoadingSpinner fullPage />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payment Management"
        description="Review and verify registration payments"
        actions={<button onClick={() => load()} className="btn btn-secondary"><RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh</button>}
      />

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            ['Total', summary.total, 'text-ink'],
            ['Approved', summary.approved, 'text-success-600'],
            ['Rejected', summary.rejected, 'text-error-600'],
            ['Pending', summary.pending, 'text-warning-600'],
            ['Manual review', summary.manualReview, 'text-info-600'],
          ].map(([label, value, color]) => (
            <div key={label} className="stat-card py-3 px-4">
              <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">{label}</p>
              <p className={`text-2xl font-bold ${color}`}>{value ?? '–'}</p>
            </div>
          ))}
        </div>
      )}

      <div className="card space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink-muted"><Filter className="h-4 w-4" aria-hidden="true" /> Filters</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <select className="input-field" aria-label="Status filter" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="manual_review">Manual review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <select className="input-field" aria-label="Payment type filter" value={filters.type} onChange={e => setFilters(f => ({ ...f, type: e.target.value }))}>
            <option value="">Registration payments</option>
            <option value="MEMBERSHIP">Membership</option>
          </select>
          <input type="date" className="input-field" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} aria-label="From date" />
          <input type="date" className="input-field" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} aria-label="To date" />
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" aria-hidden="true" />
            <input
              className="input-field pl-9"
              aria-label="Search payments"
              placeholder="User ID, email, UTR, payment ID"
              value={filters.search}
              onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') load(); }}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => load()} className="btn btn-primary">Apply filters</button>
          <button onClick={() => { setFilters(EMPTY_FILTERS); load(EMPTY_FILTERS); }} className="btn btn-secondary">Reset</button>
        </div>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : payments.length === 0 ? (
        <div className="table-shell"><EmptyState icon={<CreditCard className="h-6 w-6" />} title="No payments found" description="There are no payment records matching your current filters." /></div>
      ) : (
        <div className="table-shell">
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr>
                <th scope="col">User</th>
                <th scope="col" className="text-right">Amount</th>
                <th scope="col">Plan</th>
                <th scope="col">Status</th>
                <th scope="col">Outcome</th>
                <th scope="col">Submitted</th>
                <th scope="col" className="text-right">Actions</th>
              </tr></thead>
              <tbody>
                {payments.map(p => (
                  <tr key={p.id}>
                    <td><p className="font-medium text-ink">{p.user?.full_name || p.user_name || p.user_id?.slice(0,8)}</p><p className="text-xs text-ink-faint">{p.user?.email || p.user_email}</p></td>
                    <td className="font-semibold text-ink text-right">₹{p.expected_amount}</td>
                    <td>₹{p.selected_plan}</td>
                    <td>
                      <StatusBadge status={p.status} />
                      {(p.rejection_reason || p.verification_result?.reason) && (
                        <p className="text-[11px] text-error-600 mt-1 max-w-[180px] break-words">{friendlyReason(p.rejection_reason || p.verification_result.reason)}</p>
                      )}
                    </td>
                    <td>
                      {p.outcome ? <StatusBadge status={p.outcome.toLowerCase()} size="sm" /> : <span className="text-xs text-ink-faint">—</span>}
                    </td>
                    <td>{new Date(p.submitted_at).toLocaleString()}</td>
                    <td>
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => openDetail(p)} className="btn btn-icon btn-sm btn-ghost" title="View details" aria-label="View details"><Eye className="h-4 w-4" aria-hidden="true" /></button>
                        {actionableFor(p.status) && <button onClick={() => { openDetail(p); setTimeout(() => setReviewAction('approve'), 100); }} className="btn btn-icon btn-sm btn-ghost text-success-600 hover:text-success-700" title="Approve payment" aria-label="Approve payment"><CheckCircle className="h-4 w-4" aria-hidden="true" /></button>}
                        {actionableFor(p.status) && <button onClick={() => { openDetail(p); setTimeout(() => setReviewAction('reject'), 100); }} className="btn btn-icon btn-sm btn-ghost text-error-600 hover:text-error-700" title="Reject payment" aria-label="Reject payment"><XCircle className="h-4 w-4" aria-hidden="true" /></button>}
                        {p.status === 'pending' && <button onClick={() => setConfirmAction({ paymentId: p.id, userName: p.user?.full_name || p.user_name || p.user_email || p.user_id?.slice(0, 8) })} className="btn btn-icon btn-sm btn-ghost text-error-600 hover:text-error-700" title="Delete registration" aria-label="Delete registration"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal isOpen={!!detail} onClose={() => { setDetail(null); setDetailFull(null); setReviewReason(''); setReviewAction(null); }} title="Payment Details" size="lg">
        {detail && (
          <div className="space-y-5">
            {detailLoading && <p className="text-sm text-ink-muted flex items-center gap-2"><RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading verification history…</p>}

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint mb-2">Payment details</p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                {[
                  ['User', detail.user?.full_name || detail.user_name || detail.user_id],
                  ['Email', detail.user?.email || detail.user_email],
                  ['Amount', `₹${detail.expected_amount}`],
                  ['Plan', `₹${detail.selected_plan}`],
                  ['Payment ID', detail.id],
                  ['UPI', detail.upi_id],
                  ['Transaction ID', (detailFull || detail).transaction_id || detail.verification_result?.transactionId || 'N/A'],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-ink-faint mb-0.5">{k}</dt>
                    <dd className="font-medium text-ink break-all">{v || '-'}</dd>
                  </div>
                ))}
                <div>
                  <dt className="text-xs text-ink-faint mb-0.5">Status</dt>
                  <dd className="flex gap-2 items-center flex-wrap">
                    <StatusBadge status={detail.status} />
                    {(outcome || detail.outcome) && <StatusBadge status={(outcome || detail.outcome).toLowerCase()} size="sm" />}
                  </dd>
                </div>
                {detailFull?.provider && (
                  <div>
                    <dt className="text-xs text-ink-faint mb-0.5">Provider verification</dt>
                    <dd className="font-medium text-ink">
                      <span className="inline-flex items-center gap-1">
                        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        {detailFull.provider.available ? detailFull.provider.mode : 'not configured (none)'}
                      </span>
                    </dd>
                  </div>
                )}
              </dl>
            </div>

            {(detail.rejection_reason || detail.verification_result?.reason) && (
              <div className="callout callout-warning">
                <span><strong>Reason:</strong> {friendlyReason(detail.rejection_reason || detail.verification_result?.reason) || detail.rejection_reason}</span>
              </div>
            )}

            {checks && (
              <div className="rounded-xl border border-line bg-surface-2/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint mb-2">Field checks</p>
                <p className="text-xs text-ink-muted mb-2">Each row compares one field read from the screenshot with the expected value. A passed check is not, by itself, an approved payment.</p>
                <CheckRow label="Receiver UPI match" check={checks.receiverUpi} />
                <CheckRow label="Amount match" check={checks.amount} />
                <CheckRow label="Transaction date/time" check={checks.transactionDate} />
                <CheckRow label="Transaction status" check={checks.transactionStatus} />
                <CheckRow label="Transaction ID (UTR)" check={checks.utr} />
                <CheckRow label="OCR confidence" check={checks.ocrConfidence} />
                <CheckRow label="Receiver name" check={checks.receiverName} />
                <CheckRow label="Sender (payer) name" check={checks.senderName} />
              </div>
            )}

            {extracted && (
              <div className="rounded-xl border border-line bg-surface-2/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint mb-2">Extracted payment details</p>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  {[
                    ['Amounts', (extracted.amounts || []).join(', ')],
                    ['UTRs', (extracted.utrs || []).join(', ')],
                    ['UPIs', (extracted.upis || []).join(', ')],
                    ['Receiver names', (extracted.receiverNames || []).join(', ')],
                    ['Sender names', (extracted.senderNames || []).join(', ')],
                    ['OCR confidence', extracted.ocrConfidence ?? '—'],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-xs text-ink-faint">{k}</dt>
                      <dd className="text-ink break-all">{v || '—'}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {detail.screenshot_url && (
              <div>
                <p className="text-xs text-ink-faint mb-2">Payment screenshot (access-controlled)</p>
                <PaymentScreenshot endpoint={`/payments/${detail.id}/screenshot`} alt="Payment screenshot" />
              </div>
            )}

            {history.length > 0 && (
              <div className="rounded-xl border border-line bg-surface-2/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint mb-2 flex items-center gap-1"><History className="h-3.5 w-3.5" aria-hidden="true" /> Verification history</p>
                <ul className="space-y-2 max-h-48 overflow-y-auto">
                  {history.map(h => (
                    <li key={h.id} className="text-sm border-b border-line pb-2 last:border-0">
                      <div className="flex items-center justify-between gap-2">
                        <StatusBadge status={(h.status || '').toLowerCase()} size="sm" />
                        <span className="text-xs text-ink-faint">{new Date(h.created_at).toLocaleString()}</span>
                      </div>
                      {(h.reason_code || h.decision) && (
                        <p className="text-xs text-ink-muted mt-1">
                          {h.reason_code ? friendlyReason(h.reason_code) || h.reason_code : h.decision}
                          {h.actor_role && <span className="text-ink-faint"> · by {h.actor_role}</span>}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {actionable && (
              <div className="space-y-3 pt-4 divider">
                <div className="space-y-2">
                  <label className="label" htmlFor="review-reason">Review reason (required — recorded in the audit log)</label>
                  <input id="review-reason" className="input-field" placeholder="e.g. Confirmed ₹120 UTR 4321... with bank statement" value={reviewReason} onChange={e => setReviewReason(e.target.value)} />
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <button onClick={() => setReviewAction('approve')} className={`btn btn-success flex-1 ${reviewAction === 'approve' ? 'ring-2 ring-success-400' : ''}`}>
                    <CheckCircle className="h-4 w-4" aria-hidden="true" /> Approve
                  </button>
                  <button onClick={() => setReviewAction('reject')} className={`btn btn-danger flex-1 ${reviewAction === 'reject' ? 'ring-2 ring-error-400' : ''}`}>
                    <XCircle className="h-4 w-4" aria-hidden="true" /> Reject
                  </button>
                  {reviewAction && (
                    <button onClick={submitReview} className="btn btn-primary flex-1">
                      Confirm {reviewAction}
                    </button>
                  )}
                </div>
                <p className="text-xs text-ink-muted">Resolving a manual review requires selecting an action AND recording a reason. Only approve after independently confirming the transaction with the provider/bank — a screenshot alone is not proof.</p>
              </div>
            )}

            {detail.user_id && (
              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button onClick={() => setConfirmAction({ userId: detail.user_id })} className="btn btn-danger flex-1">
                  <UserX className="h-4 w-4" aria-hidden="true" /> Delete User
                </button>
                {detail.status === 'pending' && detail.id && (
                  <button onClick={() => setConfirmAction({ paymentId: detail.id, userName: detail.user?.full_name || detail.user_name || detail.user_email || detail.user_id?.slice(0, 8) })} className="btn btn-danger flex-1">
                    <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete Registration &amp; Payment
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={async () => {
          if (confirmAction?.paymentId) {
            await handleDeletePayment(confirmAction.paymentId);
          } else if (confirmAction?.userId) {
            await handleDeleteUser(confirmAction.userId);
          }
        }}
        title={confirmAction?.paymentId ? 'Delete Registration' : 'Disable User (Soft Delete)'}
        message={
          confirmAction?.paymentId
            ? `This will permanently delete the pending registration and payment for "${confirmAction.userName || 'this user'}". This action cannot be undone. If the account has financial records, deletion will be blocked.`
            : 'This will disable access (soft delete). The user will be marked as deleted and cannot log in. All existing records will be preserved for administrative review.'
        }
        confirmText={confirmAction?.paymentId ? 'Delete Registration' : 'Disable'}
        confirmVariant="danger"
      />
    </div>
  );
}

function actionableFor(status) {
  return ['pending', 'manual_review'].includes(status);
}
