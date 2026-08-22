import { useState, useEffect } from 'react';
import { Search, Eye, UserCheck, UserX, Trash2, Key } from 'lucide-react';
import PasswordInput from '../../components/PasswordInput';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import { PLAN_MAP } from '../../utils/constants';
import StatusBadge from '../../components/StatusBadge';
import Modal from '../../components/Modal';
import ConfirmDialog from '../../components/ConfirmDialog';
import LoadingSpinner from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [detailUser, setDetailUser] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pendingPlanChanges, setPendingPlanChanges] = useState({});
  const [resetPwUser, setResetPwUser] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetting, setResetting] = useState(false);

  const load = (p = 1) => {
    setLoading(true);
    api.get(`/admin/users?page=${p}&limit=20&search=${search}`).then(r => {
      setUsers(r.data.data?.users || r.data.data || []);
      setTotalPages(r.data.data?.totalPages || 1);
      setPage(p);
    }).catch(() => toast.error('Failed to load users')).finally(() => setLoading(false));
    api.get('/admin/plan-change-requests').then(r => {
      const map = {};
      (r.data?.data || []).forEach(x => { if (x.status === 'pending') map[x.user_id] = x.requested_plan; });
      setPendingPlanChanges(map);
    }).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const openUserDetail = async (u) => {
    setDetailUser(u);
    setDetailLoading(true);
    try {
      const { data } = await api.get(`/admin/users/${u.id}`);
      setDetailUser(data.data);
    } catch (err) { /* keep basic data */ }
    setDetailLoading(false);
  };

  const handleAction = async (action, userId) => {
    try {
      if (action === 'activate') {
        await api.put(`/admin/users/${userId}/status`, { status: 'active' });
        toast.success('User activated');
      } else if (action === 'deactivate') {
        await api.put(`/admin/users/${userId}/status`, { status: 'inactive', reason: 'Admin deactivation' });
        toast.success('User deactivated');
      } else if (action === 'delete') {
        await api.delete(`/admin/users/${userId}`);
        toast.success('User deleted successfully');
      }
      setConfirmAction(null); setDetailUser(null); load(page);
    } catch (err) { toast.error(err.response?.data?.message || 'Action failed'); }
  };

  const handleResetPassword = async () => {
    if (!newPassword || newPassword.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    if (newPassword !== confirmPassword) { toast.error('Passwords do not match'); return; }
    setResetting(true);
    try {
      await api.patch(`/admin/users/${resetPwUser.id}/password`, { newPassword });
      toast.success('Password reset successfully');
      setResetPwUser(null); setNewPassword(''); setConfirmPassword('');
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to reset password'); }
    finally { setResetting(false); }
  };

  const confirmTitle = confirmAction?.action === 'delete'
    ? 'Delete user permanently?'
    : confirmAction?.action === 'activate'
      ? 'Activate user?'
      : 'Deactivate user?';

  const confirmMessage = confirmAction?.action === 'delete'
    ? `User: ${confirmAction.user?.full_name || 'Unknown'}\nEmail: ${confirmAction.user?.email || '-'}\nCurrent Plan: ${PLAN_MAP[confirmAction.user?.current_plan]?.label || '-'}${confirmAction.user?.id && pendingPlanChanges[confirmAction.user.id] ? `\nPending Request: ${PLAN_MAP[pendingPlanChanges[confirmAction.user.id]]?.label || '-'}` : ''}\n\nThis will permanently remove this user's account and all user-owned data. This action cannot be undone.`
    : confirmAction?.action === 'activate'
      ? 'This user will regain access to their account and the platform.'
      : 'This user will lose access to their account until reactivated.';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">User Management</h1>
          <p className="text-sm text-gray-500 mt-1">View, activate, deactivate and manage members</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input className="input-field pl-10" placeholder="Search users..." value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} />
        </div>
        <button onClick={() => load()} className="btn-secondary">Search</button>
      </div>

      {loading ? <LoadingSpinner /> : users.length === 0 ? (
        <div className="table-shell"><EmptyState icon={<Users className="h-10 w-10" />} title="No users found" description="No registered users match your current search." /></div>
      ) : (
        <>
          <div className="table-shell overflow-x-auto">
            <table className="w-full text-sm min-w-[680px]">
              <thead className="bg-slate-800/50"><tr>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-slate-400">User</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-slate-400">Email</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-slate-400">Plan</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-slate-400">Referrals</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-slate-400">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-slate-400">Plan Change</th>
                <th className="text-right px-4 py-3 font-semibold text-xs uppercase tracking-wider text-slate-400">Actions</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-500/10">
                {users.map(u => (
                  <tr key={u.id} className="hover:bg-primary-500/10 transition-colors">
                    <td className="px-4 py-3"><p className="font-medium text-slate-100">{u.full_name}</p><p className="text-xs text-slate-500 font-mono">{u.id?.slice(0,8)}</p></td>
                    <td className="px-4 py-3 text-slate-400">{u.email}</td>
                    <td className="px-4 py-3">{PLAN_MAP[u.current_plan]?.label || '-'}</td>
                    <td className="px-4 py-3">
                      {u.referral_count > 0 ? (
                        <button onClick={() => openUserDetail(u)} className="font-semibold text-primary-400 hover:text-primary-300 hover:underline cursor-pointer transition-colors">{u.referral_count}</button>
                      ) : (
                        <span className="text-gray-400">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={u.status} /></td>
                    <td className="px-4 py-3">
                      {pendingPlanChanges[u.id]
                        ? <span className="inline-flex items-center gap-1.5 text-xs rounded-full border border-warning-200 bg-warning-50 px-2.5 py-1"><span className="h-1.5 w-1.5 rounded-full bg-warning-500" /><span className="font-semibold text-warning-700">Plan Change Pending</span><span className="text-warning-600">Requested: {PLAN_MAP[pendingPlanChanges[u.id]]?.label}</span></span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => openUserDetail(u)} className="w-10 h-10 hover:bg-primary-500/15 rounded-xl border border-slate-500/20 text-slate-400 hover:text-primary-400 flex items-center justify-center" title="View details"><Eye className="h-4 w-4" /></button>
                        {u.status !== 'active' && <button onClick={() => setConfirmAction({ action: 'activate', id: u.id, label: 'activate this user' })} className="w-10 h-10 hover:bg-success-500/15 rounded-xl border border-slate-500/20 text-success-400 flex items-center justify-center" title="Activate user"><UserCheck className="h-4 w-4" /></button>}
                        {u.status === 'active' && <button onClick={() => setConfirmAction({ action: 'deactivate', id: u.id, label: 'deactivate this user' })} className="w-10 h-10 hover:bg-warning-500/15 rounded-xl border border-slate-500/20 text-warning-400 flex items-center justify-center" title="Deactivate user"><UserX className="h-4 w-4" /></button>}
                        <button onClick={() => setConfirmAction({ action: 'delete', id: u.id, user: u })} className="w-10 h-10 hover:bg-error-500/15 rounded-xl border border-slate-500/20 text-error-400 flex items-center justify-center" title="Permanently delete this user and all their data"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex justify-center gap-2">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                <button key={p} onClick={() => load(p)} className={`px-3.5 py-1.5 rounded-lg text-sm font-medium border transition-colors ${p === page ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>{p}</button>
              ))}
            </div>
          )}
        </>
      )}

      <Modal isOpen={!!detailUser} onClose={() => setDetailUser(null)} title="User Details">
        {detailUser && (<>
          {detailLoading && <p className="text-sm text-gray-400 mb-3">Loading full details...</p>}
          <dl className="space-y-3 text-sm">
            {[
              ['Name', detailUser.full_name],
              ['Email', detailUser.email],
              ['Mobile', detailUser.mobile],
              ['ID', detailUser.id],
              ['Plan', PLAN_MAP[detailUser.current_plan]?.label || '-'],
              ['Referral Code', detailUser.referral_code],
              ['Joined', new Date(detailUser.created_at).toLocaleString()],
            ].map(([k, v]) => (
              <div key={k} className="flex items-start justify-between gap-4 border-b border-gray-100 pb-2 last:border-0">
                <dt className="text-gray-500">{k}</dt>
                <dd className="font-medium text-gray-900 text-right break-all">{v || '-'}</dd>
              </div>
            ))}
            <div className="flex items-center justify-between gap-4">
              <dt className="text-gray-500">Status</dt>
              <dd><StatusBadge status={detailUser.status} /></dd>
            </div>
            {detailUser.inactive_reason && (
              <div className="flex items-start justify-between gap-4">
                <dt className="text-gray-500">Inactive Reason</dt>
                <dd className="font-medium text-gray-900 text-right">{detailUser.inactive_reason}</dd>
              </div>
            )}
          </dl>

          <div className="mt-4 pt-4 border-t border-gray-100 space-y-4">
            <div>
              <p className="text-sm font-medium text-gray-700 mb-1">Referred By</p>
              {detailUser.referredByUser ? (
                <div className="bg-gray-50 rounded-lg p-3 text-sm">
                  <p className="font-medium text-gray-900">{detailUser.referredByUser.full_name}</p>
                  <p className="text-gray-500">{detailUser.referredByUser.email}</p>
                </div>
              ) : (
                <p className="text-sm text-gray-400">None (direct registration)</p>
              )}
            </div>

            <div>
              <p className="text-sm font-medium text-gray-700 mb-1">Referred Users ({detailUser.referrals?.length || 0})</p>
              {detailUser.referrals?.length > 0 ? (
                <div className="space-y-2">
                  {detailUser.referrals.map(r => (
                    <div key={r.id} className="bg-gray-50 rounded-lg p-3 text-sm">
                      <p className="font-medium text-gray-900">{r.full_name}</p>
                      <p className="text-gray-500">{r.email}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">None</p>
              )}
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100">
            <button onClick={() => { setResetPwUser(detailUser); setNewPassword(''); setConfirmPassword(''); }} className="btn-secondary w-full flex items-center justify-center gap-2">
              <Key className="h-4 w-4" /> Reset Password
            </button>
          </div>
        </>)}
      </Modal>

      <Modal isOpen={!!resetPwUser} onClose={() => setResetPwUser(null)} title="Reset User Password">
        <div className="space-y-4">
          <div className="bg-gray-50 rounded-lg p-3 text-sm">
            <p className="text-gray-900 font-medium">{resetPwUser?.full_name}</p>
            <p className="text-gray-500">{resetPwUser?.email}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
            <PasswordInput placeholder="Minimum 6 characters" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
            <PasswordInput placeholder="Re-enter new password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleResetPassword()} />
          </div>
          {newPassword && confirmPassword && newPassword !== confirmPassword && (
            <p className="text-xs text-error-600">Passwords do not match</p>
          )}
          <button onClick={handleResetPassword} disabled={resetting || !newPassword || newPassword.length < 6 || newPassword !== confirmPassword} className="btn-primary w-full">
            {resetting ? 'Resetting...' : 'Reset Password'}
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => handleAction(confirmAction?.action, confirmAction?.id)}
        title={confirmTitle}
        message={confirmMessage}
        confirmText={confirmAction?.action === 'delete' ? 'Delete' : confirmAction?.action === 'activate' ? 'Activate' : 'Deactivate'}
        confirmVariant={confirmAction?.action === 'delete' ? 'danger' : 'success'}
      />
    </div>
  );
}