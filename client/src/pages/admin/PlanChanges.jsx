import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import { PLAN_MAP } from '../../utils/constants';
import StatusBadge from '../../components/StatusBadge';
import ConfirmDialog from '../../components/ConfirmDialog';
import LoadingSpinner from '../../components/LoadingSpinner';

export default function PlanChanges() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
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
  const handleDelete = async (id) => {
    try { await api.delete(`/admin/plan-change-requests/${id}`); toast.success('Deleted'); setConfirmDelete(null); load(); }
    catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
  };

  if (loading) return <LoadingSpinner fullPage />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Plan Change Requests</h1>
        <p className="text-sm text-gray-500 mt-1">Review requests to change membership plans</p>
      </div>
      {requests.length === 0 ? (
        <div className="table-shell"><p className="text-gray-500 text-center py-12">No pending requests</p></div>
      ) : (
        <div className="table-shell overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-gray-50/60"><tr>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">User</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Current</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Requested</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Date</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Status</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {requests.map(r => (
                <tr key={r.id} className="hover:bg-gray-50/60 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{r.user?.full_name || r.user_name || r.user_email}</td>
                  <td className="px-4 py-3">{PLAN_MAP[r.current_plan]?.label}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{PLAN_MAP[r.requested_plan]?.label}</td>
                  <td className="px-4 py-3 text-gray-500">{new Date(r.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {r.status === 'pending' && <>
                        <button onClick={() => handleApprove(r.id)} className="p-2 hover:bg-success-50 rounded-lg border border-gray-200 text-success-600" title="Approve request"><CheckCircle className="h-4 w-4" /></button>
                        <button onClick={() => handleReject(r.id)} className="p-2 hover:bg-error-50 rounded-lg border border-gray-200 text-error-600" title="Reject request"><XCircle className="h-4 w-4" /></button>
                      </>}
                      <button onClick={() => setConfirmDelete(r)} className="p-2 hover:bg-gray-100 rounded-lg border border-gray-200 text-gray-400 hover:text-gray-600" title="Delete request"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog isOpen={!!confirmDelete} onClose={() => setConfirmDelete(null)} onConfirm={() => handleDelete(confirmDelete?.id)} title="Delete Request" message="Delete this plan change request?" confirmText="Delete" confirmVariant="danger" />
    </div>
  );
}