import { useState, useEffect } from 'react';
import { UserCheck, UserX, Phone, Mail } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import StatusBadge from '../../components/StatusBadge';
import LoadingSpinner from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import PageHeader from '../../components/PageHeader';

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
      <PageHeader title="Inactive Users" description="Users who are currently deactivated" />
      {users.length === 0 ? (
        <div className="table-shell"><EmptyState icon={<UserX className="h-6 w-6" />} title="No inactive users" description="All registered users are currently active." /></div>
      ) : (
        <div className="table-shell">
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr>
                <th scope="col">User</th>
                <th scope="col">Email</th>
                <th scope="col">Mobile</th>
                <th scope="col">Status</th>
                <th scope="col" className="text-right">Action</th>
              </tr></thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td>
                      <p className="font-medium text-ink">{u.full_name}</p>
                    </td>
                    <td>
                      <span className="flex items-center gap-1.5">
                        <Mail className="h-3.5 w-3.5 text-ink-faint" aria-hidden="true" /> {u.email}
                      </span>
                    </td>
                    <td>
                      <span className="flex items-center gap-1.5">
                        <Phone className="h-3.5 w-3.5 text-ink-faint" aria-hidden="true" /> {u.mobile || '-'}
                      </span>
                    </td>
                    <td><StatusBadge status={u.status} /></td>
                    <td>
                      <div className="flex items-center justify-end">
                        <button onClick={() => handleActivate(u.id)} className="btn btn-success btn-sm">
                          <UserCheck className="h-4 w-4" aria-hidden="true" /> Activate
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
