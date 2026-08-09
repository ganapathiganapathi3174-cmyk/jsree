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
      } else if (action === 'hardDelete') {
        await api.delete(`/admin/users/${userId}?soft=false`);
        toast.success('User permanently deleted');
      }
      setConfirmAction(null); setDetailUser(null); load(page);
    } catch (err) { toast.error(err.response?.data?.message || 'Action failed'); }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md"><Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" /><input className="input-field pl-10" placeholder="Search users..." value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} /></div>
        <button onClick={() => load()} className="btn-secondary">Search</button>
      </div>

      {loading ? <LoadingSpinner /> : users.length === 0 ? (
        <p className="text-gray-500 text-center py-8">No users found</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50"><tr>
                <th className="text-left p-3 font-medium text-gray-600">User</th>
                <th className="text-left p-3 font-medium text-gray-600">Email</th>
                <th className="text-left p-3 font-medium text-gray-600">Plan</th>
                <th className="text-left p-3 font-medium text-gray-600">Referrals</th>
                <th className="text-left p-3 font-medium text-gray-600">Status</th>
                <th className="text-left p-3 font-medium text-gray-600">Actions</th>
              </tr></thead>
              <tbody className="divide-y">
                {users.map(u => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="p-3"><p className="font-medium">{u.full_name}</p><p className="text-xs text-gray-500">{u.id?.slice(0,8)}</p></td>
                    <td className="p-3 text-gray-600">{u.email}</td>
                    <td className="p-3">{PLAN_MAP[u.current_plan]?.label || '-'}</td>
                    <td className="p-3">{u.referral_count || 0}</td>
                    <td className="p-3"><StatusBadge status={u.status} /></td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <button onClick={() => setDetailUser(u)} className="p-1 hover:bg-gray-100 rounded"><Eye className="h-4 w-4 text-gray-500" /></button>
                        {u.status !== 'active' && <button onClick={() => setConfirmAction({ action: 'activate', id: u.id, label: 'activate this user' })} className="p-1 hover:bg-green-50 rounded"><UserCheck className="h-4 w-4 text-green-600" /></button>}
                        {u.status === 'active' && <button onClick={() => setConfirmAction({ action: 'deactivate', id: u.id, label: 'deactivate this user' })} className="p-1 hover:bg-yellow-50 rounded"><UserX className="h-4 w-4 text-yellow-600" /></button>}
                        <button onClick={() => setConfirmAction({ action: 'delete', id: u.id, label: 'deactivate this user (soft delete)' })} className="p-1 hover:bg-red-50 rounded" title="Soft Delete"><Trash2 className="h-4 w-4 text-red-600" /></button>
                        <button onClick={() => setConfirmAction({ action: 'hardDelete', id: u.id, label: 'PERMANENTLY delete this user and ALL their data (payments, referrals, messages, etc.)' })} className="p-1 hover:bg-red-100 rounded" title="Permanent Delete"><Trash2 className="h-4 w-4 text-red-800" /></button>
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
                <button key={p} onClick={() => load(p)} className={`px-3 py-1 rounded ${p === page ? 'bg-primary-600 text-white' : 'bg-gray-200'}`}>{p}</button>
              ))}
            </div>
          )}
        </>
      )}

      <Modal isOpen={!!detailUser} onClose={() => setDetailUser(null)} title="User Details">
        {detailUser && (
          <div className="space-y-2 text-sm">
            <p><strong>Name:</strong> {detailUser.full_name}</p>
            <p><strong>Email:</strong> {detailUser.email}</p>
            <p><strong>Mobile:</strong> {detailUser.mobile}</p>
            <p><strong>ID:</strong> {detailUser.id}</p>
            <p><strong>Plan:</strong> {PLAN_MAP[detailUser.current_plan]?.label}</p>
            <p><strong>Referral Code:</strong> {detailUser.referral_code}</p>
            <p><strong>Referrals:</strong> {detailUser.referral_count || 0}</p>
            <p><strong>Status:</strong> <StatusBadge status={detailUser.status} /></p>
            <p><strong>Joined:</strong> {new Date(detailUser.created_at).toLocaleString()}</p>
            {detailUser.inactive_reason && <p><strong>Inactive Reason:</strong> {detailUser.inactive_reason}</p>}
          </div>
        )}
      </Modal>

      <ConfirmDialog isOpen={!!confirmAction} onClose={() => setConfirmAction(null)} onConfirm={() => handleAction(confirmAction?.action, confirmAction?.id)} title={confirmAction?.action === 'hardDelete' ? '⚠️ Permanent Delete' : `Confirm ${confirmAction?.action}`} message={confirmAction?.action === 'hardDelete' ? 'This will PERMANENTLY delete this user and ALL their data (payments, referrals, messages, notifications, wallet, audit logs). This cannot be undone!' : `Are you sure you want to ${confirmAction?.label}?`} confirmText={confirmAction?.action === 'hardDelete' ? 'Yes, Delete Forever' : confirmAction?.action === 'delete' ? 'Soft Delete' : 'Confirm'} confirmVariant="danger" />
    </div>
  );
}
