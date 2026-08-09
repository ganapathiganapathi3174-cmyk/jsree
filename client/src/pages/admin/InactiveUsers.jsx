import { useState, useEffect } from 'react';
import { UserCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import { PLAN_MAP } from '../../utils/constants';
import StatusBadge from '../../components/StatusBadge';
import LoadingSpinner from '../../components/LoadingSpinner';

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
      <h1 className="text-2xl font-bold text-gray-900">Inactive Users</h1>
      {users.length === 0 ? <p className="text-gray-500 text-center py-8">No inactive users</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr>
              <th className="text-left p-3 font-medium text-gray-600">User</th>
              <th className="text-left p-3 font-medium text-gray-600">Plan</th>
              <th className="text-left p-3 font-medium text-gray-600">Referrals</th>
              <th className="text-left p-3 font-medium text-gray-600">Reason</th>
              <th className="text-left p-3 font-medium text-gray-600">Since</th>
              <th className="text-left p-3 font-medium text-gray-600">Action</th>
            </tr></thead>
            <tbody className="divide-y">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="p-3"><p className="font-medium">{u.full_name}</p><p className="text-xs text-gray-500">{u.email}</p></td>
                  <td className="p-3">{PLAN_MAP[u.current_plan]?.label}</td>
                  <td className="p-3">{u.referral_count || 0}</td>
                  <td className="p-3 text-sm text-gray-600">{u.inactive_reason || '-'}</td>
                  <td className="p-3 text-gray-500">{u.inactive_since ? new Date(u.inactive_since).toLocaleDateString() : '-'}</td>
                  <td className="p-3"><button onClick={() => handleActivate(u.id)} className="btn-success text-sm flex items-center gap-1"><UserCheck className="h-3 w-3" /> Activate</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
