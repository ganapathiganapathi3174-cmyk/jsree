import { useState, useEffect } from 'react';
import { Search, Eye, UserCheck, UserX, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import { PLAN_MAP } from '../../utils/constants';
import StatusBadge from '../../components/StatusBadge';
import Modal from '../../components/Modal';
import ConfirmDialog from '../../components/ConfirmDialog';
import LoadingSpinner from '../../components/LoadingSpinner';

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [detailUser, setDetailUser] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const load = (p = 1) => {
    setLoading(true);
    api.get(`/admin/users?page=${p}&limit=20&search=${search}`).then(r => {
      setUsers(r.data.data?.users || r.data.data || []);
      setTotalPages(r.data.data?.totalPages || 1);
      setPage(p);
    }).catch(() => toast.error('Failed to load users')).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

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
        toast.success('User deleted');
      }
      setConfirmAction(null); setDetailUser(null); load(page);
    } catch (err) { toast.error(err.response?.data?.message || 'Action failed'); }
  };

  const confirmTitle = confirmAction?.action === 'delete'
    ? 'Delete user permanently?'
    : confirmAction?.action === 'activate'
      ? 'Activate user?'
      : 'Deactivate user?';

  const confirmMessage = confirmAction?.action === 'delete'
    ? 'This will remove the user\'s account and all associated user data. This action cannot be undone.'
    : confirmAction?.action === 'activate'
      ? 'This user will regain access to their account and the platform.'
      : 'This user will lose access to their account until reactivated.';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
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
        <div className="table-shell"><p className="text-gray-500 text-center py-12">No users found</p></div>
      ) : (
        <>
          <div className="table-shell overflow-x-auto">
            <table className="w-full text-sm min-w-[680px]">
              <thead className="bg-gray-50/60"><tr>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">User</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Email</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Plan</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Referrals</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Actions</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {users.map(u => (
                  <tr key={u.id} className="hover:bg-gray-50/60 transition-colors">
                    <td className="px-4 py-3"><p className="font-medium text-gray-900">{u.full_name}</p><p className="text-xs text-gray-500 font-mono">{u.id?.slice(0,8)}</p></td>
                    <td className="px-4 py-3 text-gray-600">{u.email}</td>
                    <td className="px-4 py-3">{PLAN_MAP[u.current_plan]?.label || '-'}</td>
                    <td className="px-4 py-3">{u.referral_count || 0}</td>
                    <td className="px-4 py-3"><StatusBadge status={u.status} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => setDetailUser(u)} className="p-2 hover:bg-gray-100 rounded-lg border border-gray-200 text-gray-500 hover:text-gray-700" title="View details"><Eye className="h-4 w-4" /></button>
                        {u.status !== 'active' && <button onClick={() => setConfirmAction({ action: 'activate', id: u.id, label: 'activate this user' })} className="p-2 hover:bg-success-50 rounded-lg border border-gray-200 text-success-600" title="Activate user"><UserCheck className="h-4 w-4" /></button>}
                        {u.status === 'active' && <button onClick={() => setConfirmAction({ action: 'deactivate', id: u.id, label: 'deactivate this user' })} className="p-2 hover:bg-warning-50 rounded-lg border border-gray-200 text-warning-600" title="Deactivate user"><UserX className="h-4 w-4" /></button>}
                        <button onClick={() => setConfirmAction({ action: 'delete', id: u.id, label: 'Delete this user permanently?' })} className="p-2 hover:bg-error-50 rounded-lg border border-gray-200 text-error-600" title="Permanently delete this user and all their data"><Trash2 className="h-4 w-4" /></button>
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
        {detailUser && (
          <dl className="space-y-3 text-sm">
            {[
              ['Name', detailUser.full_name],
              ['Email', detailUser.email],
              ['Mobile', detailUser.mobile],
              ['ID', detailUser.id],
              ['Plan', PLAN_MAP[detailUser.current_plan]?.label || '-'],
              ['Referral Code', detailUser.referral_code],
              ['Referrals', detailUser.referral_count || 0],
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
        )}
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