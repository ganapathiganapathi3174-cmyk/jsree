import { useState, useEffect } from 'react';
import { Search, ScrollText } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import LoadingSpinner from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';

export default function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = () => {
    setLoading(true);
    api.get(`/admin/audit-logs${search ? `?search=${search}` : ''}`).then(r => setLogs(r.data.data || [])).catch(() => toast.error('Failed to load')).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  if (loading) return <LoadingSpinner fullPage />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Audit Logs</h1>
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md"><Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" /><input className="input-field pl-10" placeholder="Filter by action..." value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} /></div>
        <button onClick={load} className="btn-secondary">Filter</button>
      </div>

      {logs.length === 0 ? (
        <EmptyState icon={<ScrollText className="h-12 w-12" />} title="No audit logs" description="System actions will appear here." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr>
              <th className="text-left p-3 font-medium text-gray-600">Time</th>
              <th className="text-left p-3 font-medium text-gray-600">Actor</th>
              <th className="text-left p-3 font-medium text-gray-600">Role</th>
              <th className="text-left p-3 font-medium text-gray-600">Action</th>
              <th className="text-left p-3 font-medium text-gray-600">Target</th>
            </tr></thead>
            <tbody className="divide-y">
              {logs.map(l => (
                <tr key={l.id} className="hover:bg-gray-50">
                  <td className="p-3 text-gray-500">{new Date(l.created_at).toLocaleString()}</td>
                  <td className="p-3 text-xs font-mono">{l.actor_id?.slice(0, 8) || 'System'}</td>
                  <td className="p-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${l.actor_role === 'admin' ? 'bg-purple-100 text-purple-700' : l.actor_role === 'system' ? 'bg-gray-100 text-gray-700' : 'bg-blue-100 text-blue-700'}`}>{l.actor_role}</span></td>
                  <td className="p-3 font-medium">{l.action}</td>
                  <td className="p-3 text-xs font-mono text-gray-500">{l.target_id?.slice(0, 8) || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
