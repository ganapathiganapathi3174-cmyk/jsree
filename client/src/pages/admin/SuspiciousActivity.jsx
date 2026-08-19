import { useState, useEffect } from 'react';
import api from '../../utils/api';
import { AlertTriangle, CheckCircle, RefreshCw, Shield } from 'lucide-react';

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

  const getSeverityColor = (severity) => {
    const colors = {
      low: 'bg-info-50 text-info-700 border border-info-200',
      medium: 'bg-warning-50 text-warning-700 border border-warning-200',
      high: 'bg-orange-50 text-orange-700 border border-orange-200',
      critical: 'bg-error-50 text-error-700 border border-error-200',
    };
    return colors[severity] || colors.low;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-warning-50 text-warning-600 flex items-center justify-center"><AlertTriangle className="h-5 w-5" /></div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Suspicious Activity</h1>
            <p className="text-sm text-gray-500 mt-0.5">Flags raised by the security system</p>
          </div>
        </div>
        <div className="flex gap-2">
          {['unresolved', 'all', 'resolved'].map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3.5 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors border ${filter === f ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>{f}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><RefreshCw className="w-6 h-6 animate-spin text-gray-500" /></div>
      ) : activities.length === 0 ? (
        <div className="table-shell text-center py-12 text-gray-500">
          <Shield className="w-12 h-12 mx-auto mb-3 opacity-50 text-gray-300" />
          <p>No suspicious activities detected</p>
        </div>
      ) : (
        <div className="space-y-3">
          {activities.map(a => (
            <div key={a.id} className={`stat-card p-4 ${a.resolved ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <span className={`px-2 py-1 rounded text-xs font-semibold ${getSeverityColor(a.severity)}`}>{a.severity.toUpperCase()}</span>
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">{a.activity_type.replace(/_/g, ' ').toUpperCase()}</p>
                    <p className="text-sm mt-0.5 text-gray-600">
                      IP: {a.ip_address} | {a.users?.email || 'N/A'}
                    </p>
                    {a.details && Object.keys(a.details).length > 0 && (
                      <p className="text-xs mt-1 text-gray-400 break-all">
                        {JSON.stringify(a.details)}
                      </p>
                    )}
                    <p className="text-xs mt-1 text-gray-400">
                      {new Date(a.created_at).toLocaleString('en-IN')}
                    </p>
                  </div>
                </div>
                {!a.resolved && (
                  <button onClick={() => resolveActivity(a.id)} className="flex items-center gap-1 px-3 py-1.5 text-sm text-success-600 hover:bg-success-50 rounded-lg border border-gray-200 whitespace-nowrap">
                    <CheckCircle size={14} /> Resolve
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {pagination.totalPages > 1 && (
        <div className="text-center">
          <button onClick={() => fetchActivities(pagination.page + 1)} className="text-sm text-primary-600 hover:text-primary-700 font-medium">Load more</button>
        </div>
      )}
    </div>
  );
}