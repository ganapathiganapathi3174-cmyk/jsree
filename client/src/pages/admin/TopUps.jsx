import { useState, useEffect } from 'react';
import { CheckCircle2, ExternalLink, Trash2, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import StatusBadge from '../../components/StatusBadge';
import ConfirmDialog from '../../components/ConfirmDialog';
import LoadingSpinner from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import { ArrowDownUp } from 'lucide-react';

export default function AdminTopUps() {
  const [topups, setTopups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [reviewAction, setReviewAction] = useState(null);

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
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Top-Up Management</h1>
        <p className="text-sm text-gray-500 mt-1">Monitor and manage top-up transfers</p>
      </div>
      {topups.length === 0 ? (
        <div className="table-shell"><EmptyState icon={<ArrowDownUp className="h-10 w-10" />} title="No top-ups found" description="There are no top-up records matching your current filters." /></div>
      ) : (
        <div className="table-shell overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-gray-50/60"><tr>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Sender</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Receiver</th>
              <th className="text-right px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Amount</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Detected reference</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Status</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Created</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Completed</th>
              <th className="text-right px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {topups.map(t => (
                <tr key={t.id} className="hover:bg-gray-50/60 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{t.sender?.full_name || t.sender_name || t.sender_id?.slice(0,8)}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{t.receiver?.full_name || t.receiver_name || t.receiver_id?.slice(0,8)}</td>
                  <td className="px-4 py-3 font-semibold text-gray-900 text-right">₹{t.amount}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">{t.verification_result?.utr || 'Not detected'}</td>
                  <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                  <td className="px-4 py-3 text-gray-500">{new Date(t.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-gray-500">{t.completed_at ? new Date(t.completed_at).toLocaleDateString() : '-'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end">
                      {t.screenshot_url && (
                        <a
                          href={t.screenshot_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-10 h-10 hover:bg-primary-50 rounded-xl border border-gray-200 text-primary-600 flex items-center justify-center"
                          title="Open uploaded payment proof"
                          aria-label="Open uploaded payment proof"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                      {t.status === 'manual_review' && (
                        <>
                          <button
                            onClick={() => setReviewAction({ id: t.id, approved: true })}
                            disabled={!t.verification_result?.utr}
                            className="w-10 h-10 hover:bg-success-50 rounded-xl border border-gray-200 text-success-600 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                            title={t.verification_result?.utr ? 'Approve after independently verifying the transaction' : 'Cannot approve because no transaction reference was detected'}
                            aria-label="Approve after independently verifying the transaction"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setReviewAction({ id: t.id, approved: false })}
                            className="w-10 h-10 hover:bg-error-50 rounded-xl border border-gray-200 text-error-600 flex items-center justify-center"
                            title="Reject top-up after review"
                            aria-label="Reject top-up after review"
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                        </>
                      )}
                      <button onClick={() => setConfirmDelete(t)} className="w-10 h-10 hover:bg-error-50 rounded-xl border border-gray-200 text-error-500 flex items-center justify-center" title="Delete this top-up"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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