import { useState, useEffect } from 'react';
import { Search, ScrollText } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import LoadingSpinner from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import PageHeader from '../../components/PageHeader';

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
      case 'admin': return 'badge-info';
      case 'system': return 'badge-neutral';
      default: return 'badge-review';
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Audit Logs" description="A record of actions across the platform" />
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint pointer-events-none" aria-hidden="true" />
          <input className="input-field pl-10" aria-label="Filter by action" placeholder="Filter by action..." value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} />
        </div>
        <button onClick={load} className="btn btn-secondary">Filter</button>
      </div>

      {logs.length === 0 ? (
        <div className="table-shell">
          <EmptyState icon={<ScrollText className="h-6 w-6" />} title="No audit logs" description="System actions will appear here." />
        </div>
      ) : (
        <div className="table-shell">
          <div className="table-scroll">
            <table className="data-table min-w-[640px]">
              <thead><tr>
                <th scope="col">Time</th>
                <th scope="col">Actor</th>
                <th scope="col">Role</th>
                <th scope="col">Action</th>
                <th scope="col">Target</th>
              </tr></thead>
              <tbody>
                {logs.map(l => (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</td>
                    <td><span className="text-xs font-mono">{l.actor_id?.slice(0, 8) || 'System'}</span></td>
                    <td><span className={`badge ${roleBadge(l.actor_role)}`}>{l.actor_role}</span></td>
                    <td className="font-medium text-ink">{l.action}</td>
                    <td><span className="text-xs font-mono">{l.target_id?.slice(0, 8) || '-'}</span></td>
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
