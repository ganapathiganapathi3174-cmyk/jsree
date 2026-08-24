import { useState, useEffect } from 'react';
import { Eye, CheckCircle, XCircle, Trash2, UserX, CreditCard } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import StatusBadge from '../../components/StatusBadge';
import Modal from '../../components/Modal';
import ConfirmDialog from '../../components/ConfirmDialog';
import LoadingSpinner from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';

export default function AdminPayments() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [confirmAction, setConfirmAction] = useState(null);

  const load = () => { api.get('/admin/payments').then(r => setPayments(r.data.data || [])).catch(() => toast.error('Failed to load')).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);

  const handleApprove = async (id) => {
    try { await api.put(`/admin/payments/${id}/approve`); toast.success('Payment approved'); setDetail(null); load(); }
    catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
  };
  const handleReject = async (id) => {
    if (!rejectReason.trim()) { toast.error('Enter rejection reason'); return; }
    try { await api.put(`/admin/payments/${id}/reject`, { reason: rejectReason }); toast.success('Payment rejected'); setDetail(null); setRejectReason(''); load(); }
    catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
  };
  const handleDeleteUser = async (userId) => {
    try { await api.delete(`/admin/users/${userId}`); toast.success('User deleted'); setConfirmAction(null); load(); }
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

  if (loading) return <LoadingSpinner fullPage />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Payment Management</h1>
        <p className="text-sm text-gray-500 mt-1">Review and verify registration payments</p>
      </div>

      {payments.length === 0 ? (
        <div className="table-shell"><EmptyState icon={<CreditCard className="h-10 w-10" />} title="No payments found" description="There are no payment records matching your current filters." /></div>
      ) : (
        <div className="table-shell overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-gray-50/60"><tr>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">User</th>
              <th className="text-right px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Amount</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Plan</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Status</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Submitted</th>
              <th className="text-right px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {payments.map(p => (
                <tr key={p.id} className="hover:bg-gray-50/60 transition-colors">
                  <td className="px-4 py-3"><p className="font-medium text-gray-900">{p.user?.full_name || p.user_name || p.user_id?.slice(0,8)}</p><p className="text-xs text-gray-500">{p.user?.email || p.user_email}</p></td>
                  <td className="px-4 py-3 font-semibold text-gray-900 text-right">₹{p.expected_amount}</td>
                  <td className="px-4 py-3 text-gray-600">₹{p.selected_plan}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={p.status} />
                    {(p.rejection_reason || p.verification_result?.reason) && (
                      <p className="text-[11px] text-error-600 mt-1 max-w-[180px] break-words">{p.rejection_reason || p.verification_result.reason}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{new Date(p.submitted_at).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => setDetail(p)} className="w-10 h-10 hover:bg-gray-100 rounded-xl border border-gray-200 text-gray-500 hover:text-primary-400 flex items-center justify-center" title="View details"><Eye className="h-4 w-4" /></button>
                      {['pending', 'manual_review'].includes(p.status) && <button onClick={() => handleApprove(p.id)} className="w-10 h-10 hover:bg-success-50 rounded-xl border border-gray-200 text-success-500 flex items-center justify-center" title="Approve payment"><CheckCircle className="h-4 w-4" /></button>}
                      {['pending', 'manual_review'].includes(p.status) && <button onClick={() => { setDetail(p); }} className="w-10 h-10 hover:bg-error-50 rounded-xl border border-gray-200 text-error-500 flex items-center justify-center" title="Reject payment"><XCircle className="h-4 w-4" /></button>}
                      {p.status === 'pending' && <button onClick={() => setConfirmAction({ paymentId: p.id, userName: p.user?.full_name || p.user_name || p.user_email || p.user_id?.slice(0, 8) })} className="w-10 h-10 hover:bg-error-50 rounded-xl border border-gray-200 text-error-500 flex items-center justify-center" title="Delete registration"><Trash2 className="h-4 w-4" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={!!detail} onClose={() => { setDetail(null); setRejectReason(''); }} title="Payment Details" size="lg">
        {detail && (
          <div className="space-y-5">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {[
                ['User', detail.user?.full_name || detail.user_name || detail.user_id],
                ['Email', detail.user?.email || detail.user_email],
                ['Amount', `₹${detail.expected_amount}`],
                ['Plan', `₹${detail.selected_plan}`],
                ['UPI', detail.upi_id],
                ['Transaction ID', detail.transaction_id || 'N/A'],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-gray-500 mb-0.5">{k}</dt>
                  <dd className="font-medium text-gray-900 break-all">{v || '-'}</dd>
                </div>
              ))}
              <div>
                <dt className="text-xs text-gray-500 mb-0.5">Status</dt>
                <dd><StatusBadge status={detail.status} /></dd>
              </div>
            </dl>

            {detail.rejection_reason && (
              <div className="rounded-lg bg-error-50 border border-error-200 px-4 py-3 text-sm text-error-700">
                <strong>Rejection reason:</strong> {detail.rejection_reason}
              </div>
            )}

            {detail.screenshot_url && (
              <div>
                <p className="text-xs text-gray-500 mb-2">Payment screenshot</p>
                <img src={detail.screenshot_url} alt="Screenshot" className="w-full rounded-lg border border-gray-200 max-h-80 object-contain bg-gray-50" />
              </div>
            )}

            {detail.status === 'pending' && (
              <div className="space-y-3 pt-4 border-t border-gray-100">
                <div className="space-y-2">
                  <label className="label" htmlFor="reject-reason">Rejection reason (required to reject)</label>
                  <input id="reject-reason" className="input-field" placeholder="Enter a reason for rejection" value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <button onClick={() => handleApprove(detail.id)} className="btn-success flex-1">
                    <CheckCircle className="h-4 w-4" /> Approve Payment
                  </button>
                  <button onClick={() => handleReject(detail.id)} className="btn-danger flex-1">
                    <XCircle className="h-4 w-4" /> Reject Payment
                  </button>
                </div>
              </div>
            )}

            {detail.user_id && (
              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button onClick={() => setConfirmAction({ userId: detail.user_id })} className="btn-danger flex-1 text-sm">
                  <UserX className="h-4 w-4" /> Delete User
                </button>
                {detail.status === 'pending' && detail.id && (
                  <button onClick={() => setConfirmAction({ paymentId: detail.id, userName: detail.user?.full_name || detail.user_name || detail.user_email || detail.user_id?.slice(0, 8) })} className="btn-danger flex-1 text-sm">
                    <Trash2 className="h-4 w-4" /> Delete Registration &amp; Payment
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
        title={confirmAction?.paymentId ? 'Delete Registration' : 'Delete User'}
        message={
          confirmAction?.paymentId
            ? `This will permanently delete the pending registration and payment for "${confirmAction.userName || 'this user'}". This action cannot be undone. If the account has financial records, deletion will be blocked.`
            : 'Are you sure? This action cannot be undone.'
        }
        confirmText={confirmAction?.paymentId ? 'Delete Registration' : 'Delete'}
        confirmVariant="danger"
      />
    </div>
  );
}