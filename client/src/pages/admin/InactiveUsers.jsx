import { useState, useEffect } from 'react';
import { UserCheck, UserX, Phone, Mail } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import StatusBadge from '../../components/StatusBadge';
import LoadingSpinner from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';

export default function InactiveUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => { api.get('/admin/inactive-users').then(r => setUsers(r.data.data || [])).catch(() => toast.error('Failed to load')).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);

  const handleActivate = async (id) => {
    try { await api.put(`/admin/users/${id}/status`, { status: 'active' }); toast.success('User activated'); load(); }
    catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
  };

  if (loading) return <LoadingSpinner fullPage />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Inactive Users</h1>
        <p className="text-sm text-gray-500 mt-1">Users who are currently deactivated</p>
      </div>
      {users.length === 0 ? (
        <div className="table-shell"><EmptyState icon={<UserX className="h-10 w-10" />} title="No inactive users" description="All registered users are currently active." /></div>
      ) : (
        <div className="table-shell overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-gray-50/60"><tr>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">User</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Email</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Mobile</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Status</th>
              <th className="text-right px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Action</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-gray-50/60 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{u.full_name}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1.5 text-gray-600">
                      <Mail className="h-3.5 w-3.5 text-gray-400" /> {u.email}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1.5 text-gray-600">
                      <Phone className="h-3.5 w-3.5 text-gray-400" /> {u.mobile || '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={u.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end">
                      <button onClick={() => handleActivate(u.id)} className="btn-success text-sm flex items-center gap-1.5">
                        <UserCheck className="h-4 w-4" /> Activate
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}