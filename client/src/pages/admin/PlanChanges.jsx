import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Trash2, Eye, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import { PLAN_MAP } from '../../utils/constants';
import StatusBadge from '../../components/StatusBadge';
import Modal from '../../components/Modal';
import ConfirmDialog from '../../components/ConfirmDialog';
import LoadingSpinner from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';

export default function PlanChanges() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailUser, setDetailUser] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = () => { api.get('/admin/plan-change-requests').then(r => setRequests(r.data.data || [])).catch(() => toast.error('Failed to load')).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);

  const handleApprove = async (id) => {
    try { await api.put(`/admin/plan-change-requests/${id}/approve`); toast.success('Request approved'); load(); }
    catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
  };
  const handleReject = async (id) => {
    try { await api.put(`/admin/plan-change-requests/${id}/reject`); toast.success('Request rejected'); load(); }
    catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
  };

  const openDetails = async (req) => {
    setDetailLoading(true);
    setDetailUser(null);
    try { const r = await api.get(`/admin/users/${req.user_id}`); setDetailUser(r.data.data); }
    catch (err) { toast.error(err.response?.data?.message || 'Failed to load user'); }
    finally { setDetailLoading(false); }
  };

  const handleDeleteUser = async (userId) => {
    try {
      await api.delete(`/admin/users/${userId}`);
      toast.success('User deleted successfully');
      setConfirmDelete(null);
      load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
  };

  if (loading) return <LoadingSpinner fullPage />;

  const Row = ({ label, value }) => (
    <div className="flex items-start justify-between gap-4 border-b border-slate-500/10 pb-2 last:border-0">
      <dt className="text-slate-400 shrink-0">{label}</dt>
      <dd className="font-medium text-slate-100 text-right break-all">{value || '-'}</dd>
    </div>
  );
  const Section = ({ title, children }) => (
    <div className="mb-5">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">{title}</h4>
      <dl className="space-y-2 text-sm">{children}</dl>
    </div>
  );

  const d = detailUser || {};
  const pendingChange = d.planChanges?.find(p => p.status === 'pending');
  const creditTotal = (d.walletTransactions || []).filter(t => t.type === 'credit').reduce((s, t) => s + Number(t.amount || 0), 0);
  const debitTotal = (d.walletTransactions || []).filter(t => t.type === 'debit').reduce((s, t) => s + Number(t.amount || 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Plan Change Requests</h1>
        <p className="text-sm text-gray-500 mt-1">Review requests to change membership plans</p>
      </div>
      {requests.length === 0 ? (
        <div className="table-shell"><EmptyState icon={<RefreshCw className="h-10 w-10" />} title="No pending requests" description="There are no plan change requests waiting for review." /></div>
      ) : (
        <div className="table-shell overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-gray-50/60"><tr>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">User</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Email</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Mobile</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Current</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Requested</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Date</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Status</th>
              <th className="text-right px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {requests.map(r => (
                <tr key={r.id} className="hover:bg-gray-50/60 transition-colors">
                  <td className="px-4 py-3"><p className="font-medium text-gray-900">{r.user?.full_name || r.user_name || r.user_email}</p><p className="text-xs text-gray-500 font-mono">{r.user_id?.slice(0, 8)}</p></td>
                  <td className="px-4 py-3 text-gray-600">{r.user?.email || r.user_email || '-'}</td>
                  <td className="px-4 py-3 text-gray-600">{r.user?.mobile || '-'}</td>
                  <td className="px-4 py-3">{PLAN_MAP[r.current_plan]?.label}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{PLAN_MAP[r.requested_plan]?.label}</td>
                  <td className="px-4 py-3 text-gray-500">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => openDetails(r)} className="w-10 h-10 hover:bg-gray-100 rounded-xl border border-gray-200 text-gray-500 hover:text-primary-400 flex items-center justify-center" title="View user details"><Eye className="h-4 w-4" /></button>
                      {r.status === 'pending' && <>
                        <button onClick={() => handleApprove(r.id)} className="w-10 h-10 hover:bg-success-50 rounded-xl border border-gray-200 text-success-500 flex items-center justify-center" title="Approve request"><CheckCircle className="h-4 w-4" /></button>
                        <button onClick={() => handleReject(r.id)} className="w-10 h-10 hover:bg-error-50 rounded-xl border border-gray-200 text-error-500 flex items-center justify-center" title="Reject request"><XCircle className="h-4 w-4" /></button>
                      </>}
                      <button onClick={() => setConfirmDelete(r)} className="w-10 h-10 hover:bg-error-50 rounded-xl border border-gray-200 text-error-500 flex items-center justify-center" title="Permanently delete this user and all their data"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={!!detailUser || detailLoading} onClose={() => setDetailUser(null)} title="User Details" size="lg">
        {detailLoading ? <LoadingSpinner /> : detailUser && (
          <div className="space-y-6 text-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-500/20 bg-slate-800/40 px-4 py-3">
              <div>
                <p className="font-semibold text-slate-100">{d.full_name}</p>
                <p className="text-sm text-slate-400">{d.email} · {d.mobile}</p>
              </div>
              <StatusBadge status={d.status} />
            </div>

            <Section title="Profile">
              <Row label="Full Name" value={d.full_name} />
              <Row label="Email" value={d.email} />
              <Row label="Mobile" value={d.mobile} />
              <Row label="Account Status" value={<StatusBadge status={d.status} />} />
              <Row label="Current Plan" value={PLAN_MAP[d.current_plan]?.label || 'None'} />
              <Row label="Registration Date" value={d.created_at ? new Date(d.created_at).toLocaleString() : null} />
              <Row label="Last Login" value={d.lastLogin ? new Date(d.lastLogin.created_at).toLocaleString() : null} />
              <Row label="Referral Code" value={d.referral_code} />
            </Section>

            <Section title="Plan Activity">
              <Row label="Current Plan" value={PLAN_MAP[d.current_plan]?.label || 'None'} />
              <Row label="Pending Plan Change" value={pendingChange ? PLAN_MAP[pendingChange.requested_plan]?.label : 'None'} />
              <Row label="Requested Plan" value={pendingChange ? PLAN_MAP[pendingChange.requested_plan]?.label : '-'} />
              <Row label="Request Status" value={pendingChange ? pendingChange.status : '-'} />
              <Row label="Request Date" value={pendingChange ? new Date(pendingChange.created_at).toLocaleString() : '-'} />
              <Row label="Previous Requests" value={(d.planChanges || []).filter(p => p.status !== 'pending').length} />
            </Section>

            <Section title="Payment Activity">
              <Row label="Payment Count" value={(d.payments || []).length} />
              {(d.payments || []).slice(0, 5).map(p => (
                <Row key={p.id} label={new Date(p.created_at).toLocaleDateString()} value={`${PLAN_MAP[p.selected_plan]?.label || p.selected_plan} · ₹${p.expected_amount} · ${p.status}`} />
              ))}
              {(d.payments || []).length === 0 && <Row label="Payments" value="None" />}
            </Section>

            <Section title="Top-up Activity">
              <Row label="Sent" value={(d.sentTopups || []).length} />
              {(d.sentTopups || []).slice(0, 5).map(t => (
                <Row key={t.id} label={new Date(t.created_at).toLocaleDateString()} value={`Sent ₹${t.amount} · ${t.status}`} />
              ))}
              <Row label="Received" value={(d.receivedTopups || []).length} />
              {(d.receivedTopups || []).slice(0, 5).map(t => (
                <Row key={t.id} label={new Date(t.created_at).toLocaleDateString()} value={`Received ₹${t.amount} · ${t.status}`} />
              ))}
              {(d.sentTopups || []).length === 0 && (d.receivedTopups || []).length === 0 && <Row label="Top-ups" value="None" />}
            </Section>

            <Section title="Wallet">
              <Row label="Current Balance" value={`₹${Number(d.wallet_balance || 0).toFixed(2)}`} />
              <Row label="Total Credit" value={`₹${creditTotal.toFixed(2)}`} />
              <Row label="Total Debit" value={`₹${debitTotal.toFixed(2)}`} />
              <Row label="Transactions" value={(d.walletTransactions || []).length} />
              {(d.walletTransactions || []).slice(0, 5).map(t => (
                <Row key={t.id} label={new Date(t.created_at).toLocaleDateString()} value={`${t.type} ₹${t.amount} · ${t.description}`} />
              ))}
              {(d.walletTransactions || []).length === 0 && <Row label="History" value="None" />}
            </Section>

            <Section title="Referrals">
              <Row label="Referred Users" value={(d.referrals || []).length} />
              {(d.referrals || []).slice(0, 5).map(u => (
                <Row key={u.id} label={new Date(u.created_at).toLocaleDateString()} value={`${u.full_name} · ${u.email} · ${u.status}`} />
              ))}
              {(d.referrals || []).length === 0 && <Row label="Referrals" value="None" />}
            </Section>

            <Section title="Other User Activity">
              <Row label="Notifications" value={(d.notifications || []).length} />
              <Row label="Conversations" value={(d.conversations || []).length} />
              <Row label="Messages" value={d.messageCount || 0} />
            </Section>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => handleDeleteUser(confirmDelete?.user_id)}
        title="Delete User Permanently?"
        message={confirmDelete ? `User: ${confirmDelete.user?.full_name || confirmDelete.user_email || 'Unknown'}\nEmail: ${confirmDelete.user?.email || '-'}\nCurrent Plan: ${PLAN_MAP[confirmDelete.current_plan]?.label || '-'}\nRequested Plan: ${PLAN_MAP[confirmDelete.requested_plan]?.label || '-'}\nRequest Status: ${confirmDelete.status}\n\nThis permanently deletes the user account and all user-owned data. This action cannot be undone.` : ''}
        confirmText="Delete User"
        confirmVariant="danger"
      />
    </div>
  );
}
