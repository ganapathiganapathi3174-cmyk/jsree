import { useState, useEffect } from 'react';
import { Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import StatusBadge from '../../components/StatusBadge';
import ConfirmDialog from '../../components/ConfirmDialog';
import LoadingSpinner from '../../components/LoadingSpinner';

export default function AdminTopUps() {
  const [topups, setTopups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = () => { api.get('/admin/topups').then(r => setTopups(r.data.data || [])).catch(() => toast.error('Failed to load')).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);

  const handleDelete = async (id) => {
    try { await api.delete(`/admin/topups/${id}`); toast.success('Top-up history deleted'); setConfirmDelete(null); load(); }
    catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
  };

  if (loading) return <LoadingSpinner fullPage />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Top-Up Management</h1>
      {topups.length === 0 ? <p className="text-gray-500 text-center py-8">No top-ups found</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr>
              <th className="text-left p-3 font-medium text-gray-600">Sender</th>
              <th className="text-left p-3 font-medium text-gray-600">Receiver</th>
              <th className="text-left p-3 font-medium text-gray-600">Amount</th>
              <th className="text-left p-3 font-medium text-gray-600">Status</th>
              <th className="text-left p-3 font-medium text-gray-600">Created</th>
              <th className="text-left p-3 font-medium text-gray-600">Completed</th>
              <th className="text-left p-3 font-medium text-gray-600">Action</th>
            </tr></thead>
            <tbody className="divide-y">
              {topups.map(t => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="p-3">{t.sender?.full_name || t.sender_name || t.sender_id?.slice(0,8)}</td>
                  <td className="p-3">{t.receiver?.full_name || t.receiver_name || t.receiver_id?.slice(0,8)}</td>
                  <td className="p-3 font-semibold">₹{t.amount}</td>
                  <td className="p-3"><StatusBadge status={t.status} /></td>
                  <td className="p-3 text-gray-500">{new Date(t.created_at).toLocaleDateString()}</td>
                  <td className="p-3 text-gray-500">{t.completed_at ? new Date(t.completed_at).toLocaleDateString() : '-'}</td>
                  <td className="p-3"><button onClick={() => setConfirmDelete(t)} className="p-1 hover:bg-red-50 rounded"><Trash2 className="h-4 w-4 text-red-600" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog isOpen={!!confirmDelete} onClose={() => setConfirmDelete(null)} onConfirm={() => handleDelete(confirmDelete?.id)} title="Delete Top-Up" message="This will delete the top-up history record. The user account will NOT be affected." confirmText="Delete" confirmVariant="danger" />
    </div>
  );
}
