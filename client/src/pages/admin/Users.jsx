import { useState, useEffect } from 'react';
import { Search, Eye, UserCheck, UserX, Trash2, Key, Users as UsersIcon } from 'lucide-react';
import PasswordInput from '../../components/PasswordInput';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import { PLAN_MAP } from '../../utils/constants';
import StatusBadge from '../../components/StatusBadge';
import Modal from '../../components/Modal';
import ConfirmDialog from '../../components/ConfirmDialog';
import LoadingSpinner from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import PageHeader from '../../components/PageHeader';

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
      } else       if (action === 'delete') {
        await api.delete(`/admin/users/${userId}?soft=true`);
        toast.success('User disabled (soft deleted) successfully');
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
    ? 'Disable user (soft delete)?'
    : confirmAction?.action === 'activate'
      ? 'Activate user?'
      : 'Deactivate user?';

  const confirmMessage = confirmAction?.action === 'delete'
    ? `User: ${confirmAction.user?.full_name || 'Unknown'}\nEmail: ${confirmAction.user?.email || '-'}\nCurrent Plan: ${PLAN_MAP[confirmAction.user?.current_plan]?.label || '-'}${confirmAction.user?.id && pendingPlanChanges[confirmAction.user.id] ? `\nPending Request: ${PLAN_MAP[pendingPlanChanges[confirmAction.user.id]]?.label || '-'}` : ''}\n\nThis will disable access (soft delete). The user will be marked as deleted and cannot log in. All existing records (payments, wallet, referrals, audit logs) will be preserved for administrative review.`
    : confirmAction?.action === 'activate'
      ? 'This user will regain access to their account and the platform.'
      : 'This user will lose access to their account until reactivated.';

  return (
    <div className="space-y-6">
      <PageHeader title="User Management" description="View, activate, deactivate and manage members" />

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint pointer-events-none" aria-hidden="true" />
          <input className="input-field pl-10" aria-label="Search users" placeholder="Search users..." value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} />
        </div>
        <button onClick={() => load()} className="btn btn-secondary">Search</button>
      </div>

      {loading ? <LoadingSpinner /> : users.length === 0 ? (
        <div className="table-shell"><EmptyState icon={<UsersIcon className="h-6 w-6" />} title="No users found" description="No registered users match your current search." /></div>
      ) : (
        <>
          <div className="table-shell">
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr>
                  <th scope="col">User</th>
                  <th scope="col">Email</th>
                  <th scope="col">Plan</th>
                  <th scope="col">Referrals</th>
                  <th scope="col">Status</th>
                  <th scope="col">Plan Change</th>
                  <th scope="col" className="text-right">Actions</th>
                </tr></thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td><p className="font-medium text-ink">{u.full_name}</p><p className="text-xs text-ink-faint font-mono">{u.id?.slice(0,8)}</p></td>
                      <td>{u.email}</td>
                      <td>{PLAN_MAP[u.current_plan]?.label || '-'}</td>
                      <td>
                        {u.referral_count > 0 ? (
                          <button onClick={() => openUserDetail(u)} className="link cursor-pointer">{u.referral_count}</button>
                        ) : (
                          <span className="text-ink-faint">0</span>
                        )}
                      </td>
                      <td><StatusBadge status={u.status} /></td>
                      <td>
                        {pendingPlanChanges[u.id]
                          ? <span className="inline-flex items-center gap-2 flex-wrap"><span className="badge badge-warning">Plan Change Pending</span><span className="text-xs text-ink-muted">Requested: {PLAN_MAP[pendingPlanChanges[u.id]]?.label}</span></span>
                          : <span className="text-ink-faint">—</span>}
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => openUserDetail(u)} className="btn btn-icon btn-sm btn-ghost" title="View details" aria-label="View details"><Eye className="h-4 w-4" aria-hidden="true" /></button>
                          {u.status !== 'active' && <button onClick={() => setConfirmAction({ action: 'activate', id: u.id, label: 'activate this user' })} className="btn btn-icon btn-sm btn-ghost text-success-600 hover:text-success-700" title="Activate user" aria-label="Activate user"><UserCheck className="h-4 w-4" aria-hidden="true" /></button>}
                          {u.status === 'active' && <button onClick={() => setConfirmAction({ action: 'deactivate', id: u.id, label: 'deactivate this user' })} className="btn btn-icon btn-sm btn-ghost text-warning-600 hover:text-warning-700" title="Deactivate user" aria-label="Deactivate user"><UserX className="h-4 w-4" aria-hidden="true" /></button>}
                           <button onClick={() => setConfirmAction({ action: 'delete', id: u.id, user: u })} className="btn btn-icon btn-sm btn-ghost text-error-600 hover:text-error-700" title="Disable user (soft delete); preserves all data" aria-label="Disable user (soft delete); preserves all data"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {totalPages > 1 && (
            <div className="flex justify-center gap-2">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                <button key={p} onClick={() => load(p)} className={`btn btn-sm ${p === page ? 'btn-primary' : 'btn-secondary'}`} aria-label={`Page ${p}`} aria-current={p === page ? 'page' : undefined}>{p}</button>
              ))}
            </div>
          )}
        </>
      )}

      <Modal isOpen={!!detailUser} onClose={() => setDetailUser(null)} title="User Details">
        {detailUser && (<>
          {detailLoading && <p className="text-sm text-ink-muted mb-3">Loading full details...</p>}
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
              <div key={k} className="flex items-start justify-between gap-4 border-b border-line pb-2 last:border-0">
                <dt className="text-ink-muted">{k}</dt>
                <dd className="font-medium text-ink text-right break-all">{v || '-'}</dd>
              </div>
            ))}
            <div className="flex items-center justify-between gap-4">
              <dt className="text-ink-muted">Status</dt>
              <dd><StatusBadge status={detailUser.status} /></dd>
            </div>
            {detailUser.inactive_reason && (
              <div className="flex items-start justify-between gap-4">
                <dt className="text-ink-muted">Inactive Reason</dt>
                <dd className="font-medium text-ink text-right">{detailUser.inactive_reason}</dd>
              </div>
            )}
          </dl>

          <div className="mt-4 pt-4 divider space-y-4">
            <div>
              <p className="text-sm font-medium text-ink-muted mb-1">Referred By</p>
              {detailUser.referredByUser ? (
                <div className="bg-surface-2 border border-line rounded-lg p-3 text-sm">
                  <p className="font-medium text-ink">{detailUser.referredByUser.full_name}</p>
                  <p className="text-ink-muted">{detailUser.referredByUser.email}</p>
                </div>
              ) : (
                <p className="text-sm text-ink-faint">None (direct registration)</p>
              )}
            </div>

            <div>
              <p className="text-sm font-medium text-ink-muted mb-1">Referred Users ({detailUser.referrals?.length || 0})</p>
              {detailUser.referrals?.length > 0 ? (
                <div className="space-y-2">
                  {detailUser.referrals.map(r => (
                    <div key={r.id} className="bg-surface-2 border border-line rounded-lg p-3 text-sm">
                      <p className="font-medium text-ink">{r.full_name}</p>
                      <p className="text-ink-muted">{r.email}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-ink-faint">None</p>
              )}
            </div>
          </div>

          <div className="mt-4 pt-4 divider">
            <button onClick={() => { setResetPwUser(detailUser); setNewPassword(''); setConfirmPassword(''); }} className="btn btn-secondary w-full">
              <Key className="h-4 w-4" aria-hidden="true" /> Reset Password
            </button>
          </div>
        </>)}
      </Modal>

      <Modal isOpen={!!resetPwUser} onClose={() => setResetPwUser(null)} title="Reset User Password">
        <div className="space-y-4">
          <div className="bg-surface-2 border border-line rounded-lg p-3 text-sm">
            <p className="text-ink font-medium">{resetPwUser?.full_name}</p>
            <p className="text-ink-muted">{resetPwUser?.email}</p>
          </div>
          <div>
            <label className="label" htmlFor="reset-new-password">New Password</label>
            <PasswordInput id="reset-new-password" placeholder="Minimum 6 characters" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="reset-confirm-password">Confirm Password</label>
            <PasswordInput id="reset-confirm-password" placeholder="Re-enter new password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleResetPassword()} />
          </div>
          {newPassword && confirmPassword && newPassword !== confirmPassword && (
            <p className="field-error" role="alert">Passwords do not match</p>
          )}
          <button onClick={handleResetPassword} disabled={resetting || !newPassword || newPassword.length < 6 || newPassword !== confirmPassword} className="btn btn-primary w-full">
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
        confirmText={confirmAction?.action === 'delete' ? 'Disable' : confirmAction?.action === 'activate' ? 'Activate' : 'Deactivate'}
        confirmVariant={confirmAction?.action === 'delete' ? 'danger' : 'success'}
      />
    </div>
  );
}
