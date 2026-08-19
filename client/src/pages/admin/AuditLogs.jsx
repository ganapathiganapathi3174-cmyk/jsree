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

  const roleBadge = (role) => {
    switch (role) {
      case 'admin': return 'bg-primary-50 text-primary-700 border border-primary-200';
      case 'system': return 'bg-gray-100 text-gray-600 border border-gray-200';
      default: return 'bg-info-50 text-info-700 border border-info-200';
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Audit Logs</h1>
        <p className="text-sm text-gray-500 mt-1">A record of actions across the platform</p>
      </div>
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input className="input-field pl-10" placeholder="Filter by action..." value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} />
        </div>
        <button onClick={load} className="btn-secondary">Filter</button>
      </div>

      {logs.length === 0 ? (
        <EmptyState icon={<ScrollText className="h-12 w-12" />} title="No audit logs" description="System actions will appear here." />
      ) : (
        <div className="table-shell overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-gray-50/60"><tr>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Time</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Actor</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Role</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Action</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-gray-500">Target</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {logs.map(l => (
                <tr key={l.id} className="hover:bg-gray-50/60 transition-colors">
                  <td className="px-4 py-3 text-gray-500">{new Date(l.created_at).toLocaleString()}</td>
                  <td className="px-4 py-3 text-xs font-mono text-gray-600">{l.actor_id?.slice(0, 8) || 'System'}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${roleBadge(l.actor_role)}`}>{l.actor_role}</span></td>
                  <td className="px-4 py-3 font-medium text-gray-900">{l.action}</td>
                  <td className="px-4 py-3 text-xs font-mono text-gray-500">{l.target_id?.slice(0, 8) || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}