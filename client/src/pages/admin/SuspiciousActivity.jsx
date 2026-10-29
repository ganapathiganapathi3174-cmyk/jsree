import { useState, useEffect } from 'react';
import api from '../../utils/api';
import { CheckCircle, Shield } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import EmptyState from '../../components/EmptyState';
import LoadingSpinner from '../../components/LoadingSpinner';

const SEVERITY_BADGES = {
  low: 'badge-info',
  medium: 'badge-warning',
  high: 'badge-error',
  critical: 'badge-error',
};

export default function SuspiciousActivity() {
  const [activities, setActivities] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('unresolved');

  useEffect(() => { fetchActivities(1); }, [filter]);

  const fetchActivities = async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 20 });
      if (filter === 'unresolved') params.append('resolved', 'false');
      else if (filter === 'resolved') params.append('resolved', 'true');
      const { data } = await api.get(`/security/suspicious?${params}`);
      if (page === 1) setActivities(data.activities);
      else setActivities(prev => [...prev, ...data.activities]);
      setPagination(data.pagination);
    } catch (e) { /* ignore */ }
    setLoading(false);
  };

  const resolveActivity = async (id) => {
    try {
      await api.put(`/security/suspicious/${id}/resolve`);
      setActivities(prev => prev.map(a => a.id === id ? { ...a, resolved: true } : a));
    } catch (e) { /* ignore */ }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Suspicious Activity"
        description="Flags raised by the security system"
        actions={(
          <div className="flex gap-2" role="group" aria-label="Filter activities">
            {['unresolved', 'all', 'resolved'].map(f => (
              <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)} className={`chip capitalize ${filter === f ? 'chip-active' : ''}`}>{f}</button>
            ))}
          </div>
        )}
      />

      {loading ? (
        <LoadingSpinner />
      ) : activities.length === 0 ? (
        <div className="table-shell">
          <EmptyState icon={<Shield className="h-6 w-6" />} title="No suspicious activity" description="No suspicious activities detected." />
        </div>
      ) : (
        <div className="space-y-3">
          {activities.map(a => (
            <div key={a.id} className={`stat-card p-4 ${a.resolved ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <span className={`badge ${SEVERITY_BADGES[a.severity] || 'badge-neutral'}`}>{a.severity.toUpperCase()}</span>
                    <span className={`badge ${a.resolved ? 'badge-success' : 'badge-warning'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${a.resolved ? 'bg-success-500' : 'bg-warning-500'}`} aria-hidden="true" />
                      {a.resolved ? 'Resolved' : 'Unresolved'}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-ink capitalize">{a.activity_type.replace(/_/g, ' ')}</p>
                    <p className="text-sm mt-0.5 text-ink-muted break-words">
                      IP: {a.ip_address} | {a.users?.email || 'N/A'}
                    </p>
                    {a.details && Object.keys(a.details).length > 0 && (
                      <p className="text-xs mt-1 text-ink-faint break-all">
                        {JSON.stringify(a.details)}
                      </p>
                    )}
                    <p className="text-xs mt-1 text-ink-faint">
                      {new Date(a.created_at).toLocaleString('en-IN')}
                    </p>
                  </div>
                </div>
                {!a.resolved && (
                  <button onClick={() => resolveActivity(a.id)} className="btn btn-sm btn-success shrink-0">
                    <CheckCircle size={14} aria-hidden="true" /> Resolve
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {pagination.totalPages > 1 && (
        <div className="flex justify-center">
          <button onClick={() => fetchActivities(pagination.page + 1)} className="btn btn-secondary">Load more</button>
        </div>
      )}
    </div>
  );
}
