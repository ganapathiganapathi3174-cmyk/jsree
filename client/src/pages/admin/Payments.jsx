import { useState, useEffect } from 'react';
import { Eye, CheckCircle, XCircle, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import StatusBadge from '../../components/StatusBadge';
import Modal from '../../components/Modal';
import ConfirmDialog from '../../components/ConfirmDialog';
import LoadingSpinner from '../../components/LoadingSpinner';

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
      <h1 className="text-2xl font-bold text-gray-900">Payment Management</h1>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50"><tr>
            <th className="text-left p-3 font-medium text-gray-600">User</th>
            <th className="text-left p-3 font-medium text-gray-600">Amount</th>
            <th className="text-left p-3 font-medium text-gray-600">Plan</th>
            <th className="text-left p-3 font-medium text-gray-600">Status</th>
            <th className="text-left p-3 font-medium text-gray-600">Submitted</th>
            <th className="text-left p-3 font-medium text-gray-600">Actions</th>
          </tr></thead>
          <tbody className="divide-y">
            {payments.map(p => (
              <tr key={p.id} className="hover:bg-gray-50">
                <td className="p-3"><p className="font-medium">{p.user?.full_name || p.user_name || p.user_id?.slice(0,8)}</p><p className="text-xs text-gray-500">{p.user?.email || p.user_email}</p></td>
                <td className="p-3 font-semibold">₹{p.expected_amount}</td>
                <td className="p-3">₹{p.selected_plan}</td>
                <td className="p-3"><StatusBadge status={p.status} /></td>
                <td className="p-3 text-gray-500">{new Date(p.submitted_at).toLocaleString()}</td>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <button onClick={() => setDetail(p)} className="p-1 hover:bg-gray-100 rounded"><Eye className="h-4 w-4 text-gray-500" /></button>
                    {['pending', 'manual_review'].includes(p.status) && <button onClick={() => handleApprove(p.id)} className="p-1 hover:bg-green-50 rounded"><CheckCircle className="h-4 w-4 text-green-600" /></button>}
                    {['pending', 'manual_review'].includes(p.status) && <button onClick={() => { setDetail(p); }} className="p-1 hover:bg-red-50 rounded"><XCircle className="h-4 w-4 text-red-600" /></button>}
                    {p.status === 'pending' && <button onClick={() => setConfirmAction({ paymentId: p.id, userName: p.user?.full_name || p.user_name || p.user_email || p.user_id?.slice(0, 8) })} className="p-1 hover:bg-red-50 rounded" title="Delete registration"><Trash2 className="h-4 w-4 text-red-600" /></button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {payments.length === 0 && <p className="text-gray-500 text-center py-8">No payments found</p>}

      <Modal isOpen={!!detail} onClose={() => { setDetail(null); setRejectReason(''); }} title="Payment Details">
        {detail && (
          <div className="space-y-4">
            <div className="space-y-2 text-sm">
              <p><strong>User:</strong> {detail.user?.full_name || detail.user_name || detail.user_id}</p>
              <p><strong>Email:</strong> {detail.user?.email || detail.user_email}</p>
              <p><strong>Amount:</strong> ₹{detail.expected_amount}</p>
              <p><strong>Plan:</strong> ₹{detail.selected_plan}</p>
              <p><strong>UPI:</strong> {detail.upi_id}</p>
              <p><strong>Transaction ID:</strong> {detail.transaction_id || 'N/A'}</p>
              <p><strong>Status:</strong> <StatusBadge status={detail.status} /></p>
              {detail.rejection_reason && <p className="text-red-600"><strong>Rejection:</strong> {detail.rejection_reason}</p>}
            </div>
            {detail.screenshot_url && <img src={detail.screenshot_url} alt="Screenshot" className="w-full rounded-lg border" />}
            {detail.status === 'pending' && (
              <div className="space-y-3 pt-3 border-t">
                <button onClick={() => handleApprove(detail.id)} className="btn-success w-full">Approve Payment</button>
                <input className="input-field" placeholder="Rejection reason" value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
                <button onClick={() => handleReject(detail.id)} className="btn-danger w-full">Reject Payment</button>
              </div>
            )}
            {detail.user_id && <button onClick={() => setConfirmAction({ userId: detail.user_id })} className="btn-danger w-full mt-3 text-sm">Delete User</button>}
            {detail.status === 'pending' && detail.id && <button onClick={() => setConfirmAction({ paymentId: detail.id, userName: detail.user?.full_name || detail.user_name || detail.user_email || detail.user_id?.slice(0, 8) })} className="btn-danger w-full mt-2 text-sm">Delete Registration &amp; Payment</button>}
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
