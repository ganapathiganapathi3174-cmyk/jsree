import { useState, useEffect } from 'react';
import { CheckCircle2, ExternalLink, Trash2, XCircle, ArrowDownUp } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import StatusBadge from '../../components/StatusBadge';
import ConfirmDialog from '../../components/ConfirmDialog';
import LoadingSpinner from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import Modal from '../../components/Modal';
import PaymentScreenshot from '../../components/PaymentScreenshot';
import PageHeader from '../../components/PageHeader';

export default function AdminTopUps() {
  const [topups, setTopups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [reviewAction, setReviewAction] = useState(null);
  const [screenshotTopup, setScreenshotTopup] = useState(null);

  const load = () => { api.get('/admin/topups').then(r => setTopups(r.data.data || [])).catch(() => toast.error('Failed to load')).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);

  const handleDelete = async (id) => {
    try { await api.delete(`/admin/topups/${id}`); toast.success('Top-up history deleted'); setConfirmDelete(null); load(); }
    catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
  };

  const handleReview = async () => {
    try {
      await api.put(`/admin/topups/${reviewAction.id}/review`, { approved: reviewAction.approved });
      toast.success(reviewAction.approved ? 'Top-up approved and credited' : 'Top-up rejected');
      setReviewAction(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to review top-up');
    }
  };

  if (loading) return <LoadingSpinner fullPage />;

  return (
    <div className="space-y-6">
      <PageHeader title="Top-Up Management" description="Monitor and manage top-up transfers" />
      {topups.length === 0 ? (
        <div className="table-shell"><EmptyState icon={<ArrowDownUp className="h-6 w-6" />} title="No top-ups found" description="There are no top-up records matching your current filters." /></div>
      ) : (
        <div className="table-shell">
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr>
                <th scope="col">Sender</th>
                <th scope="col">Receiver</th>
                <th scope="col" className="text-right">Amount</th>
                <th scope="col">Detected reference</th>
                <th scope="col">Status</th>
                <th scope="col">Created</th>
                <th scope="col">Completed</th>
                <th scope="col" className="text-right">Actions</th>
              </tr></thead>
              <tbody>
                {topups.map(t => (
                  <tr key={t.id}>
                    <td className="font-medium text-ink">{t.sender?.full_name || t.sender_name || t.sender_id?.slice(0,8)}</td>
                    <td className="font-medium text-ink">{t.receiver?.full_name || t.receiver_name || t.receiver_id?.slice(0,8)}</td>
                    <td className="font-semibold text-ink text-right">₹{t.amount}</td>
                    <td className="font-mono text-xs">{t.verification_result?.utr || 'Not detected'}</td>
                    <td><StatusBadge status={t.status} /></td>
                    <td>{new Date(t.created_at).toLocaleDateString()}</td>
                    <td>{t.completed_at ? new Date(t.completed_at).toLocaleDateString() : '-'}</td>
                    <td>
                      <div className="flex items-center justify-end">
                        {t.screenshot_url && (
                          <button
                            onClick={() => setScreenshotTopup(t)}
                            className="btn btn-icon btn-sm btn-ghost text-primary-600 hover:text-primary-700"
                            title="Open uploaded payment proof"
                            aria-label="Open uploaded payment proof"
                          >
                            <ExternalLink className="h-4 w-4" aria-hidden="true" />
                          </button>
                        )}
                        {t.status === 'manual_review' && (
                          <>
                            <button
                              onClick={() => setReviewAction({ id: t.id, approved: true })}
                              disabled={!t.verification_result?.utr}
                              className="btn btn-icon btn-sm btn-ghost text-success-600 hover:text-success-700"
                              title={t.verification_result?.utr ? 'Approve after independently verifying the transaction' : 'Cannot approve because no transaction reference was detected'}
                              aria-label="Approve after independently verifying the transaction"
                            >
                              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                            </button>
                            <button
                              onClick={() => setReviewAction({ id: t.id, approved: false })}
                              className="btn btn-icon btn-sm btn-ghost text-error-600 hover:text-error-700"
                              title="Reject top-up after review"
                              aria-label="Reject top-up after review"
                            >
                              <XCircle className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </>
                        )}
                        <button onClick={() => setConfirmDelete(t)} className="btn btn-icon btn-sm btn-ghost text-error-600 hover:text-error-700" title="Delete this top-up" aria-label="Delete this top-up"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal isOpen={!!screenshotTopup} onClose={() => setScreenshotTopup(null)} title="Payment proof" size="lg">
        {screenshotTopup && (
          <PaymentScreenshot endpoint={`/admin/topups/${screenshotTopup.id}/screenshot`} alt="Top-up payment proof" />
        )}
      </Modal>

      <ConfirmDialog isOpen={!!confirmDelete} onClose={() => setConfirmDelete(null)} onConfirm={() => handleDelete(confirmDelete?.id)} title="Delete this top-up permanently?" message="Only this top-up payment record and its own verification data will be removed. The user account, wallet, wallet balance, referrals and all other top-ups will remain." confirmText="Delete" confirmVariant="danger" />
      <ConfirmDialog
        isOpen={!!reviewAction}
        onClose={() => setReviewAction(null)}
        onConfirm={handleReview}
        title={reviewAction?.approved ? 'Approve this top-up?' : 'Reject this top-up?'}
        message={reviewAction?.approved
          ? 'Only approve after confirming the transaction, receiver, amount, and reference directly with the payment provider or bank. A screenshot and OCR result are not proof by themselves. Approval credits both wallets.'
          : 'Reject this top-up after reviewing the uploaded proof and verification details.'}
        confirmText={reviewAction?.approved ? 'Approve and credit' : 'Reject top-up'}
        confirmVariant={reviewAction?.approved ? 'success' : 'danger'}
      />
    </div>
  );
}
