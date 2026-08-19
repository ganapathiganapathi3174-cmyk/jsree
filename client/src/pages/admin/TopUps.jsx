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
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Top-Up Management</h1>
        <p className="text-sm text-gray-500 mt-1">Monitor and manage top-up transfers</p>
      </div>
      {topups.length === 0 ? (
        <div className="table-shell"><p className="text-gray-500 text-center py-12">No top-ups found</p></div>
      ) : (
        <div className="table-shell overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="bg-gray-50/60"><tr>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Sender</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Receiver</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Amount</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Status</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Created</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Completed</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Action</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {topups.map(t => (
                <tr key={t.id} className="hover:bg-gray-50/60 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{t.sender?.full_name || t.sender_name || t.sender_id?.slice(0,8)}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{t.receiver?.full_name || t.receiver_name || t.receiver_id?.slice(0,8)}</td>
                  <td className="px-4 py-3 font-semibold text-gray-900">₹{t.amount}</td>
                  <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                  <td className="px-4 py-3 text-gray-500">{new Date(t.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-gray-500">{t.completed_at ? new Date(t.completed_at).toLocaleDateString() : '-'}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => setConfirmDelete(t)} className="p-2 hover:bg-error-50 rounded-lg border border-gray-200 text-error-600" title="Delete this top-up"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog isOpen={!!confirmDelete} onClose={() => setConfirmDelete(null)} onConfirm={() => handleDelete(confirmDelete?.id)} title="Delete this top-up permanently?" message="Only this top-up and its related data will be removed." confirmText="Delete" confirmVariant="danger" />
    </div>
  );
}