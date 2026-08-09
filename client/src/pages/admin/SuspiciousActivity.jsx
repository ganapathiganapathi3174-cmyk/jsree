import { useState, useEffect } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import api from '../../utils/api';
import { AlertTriangle, CheckCircle, RefreshCw, Shield } from 'lucide-react';

export default function SuspiciousActivity() {
  const { dark } = useTheme();
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
    const colors = { low: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400', medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400', high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400', critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' };
    return colors[severity] || colors.low;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AlertTriangle className={`w-8 h-8 ${dark ? 'text-orange-400' : 'text-orange-600'}`} />
          <h1 className={`text-2xl font-bold ${dark ? 'text-white' : 'text-gray-900'}`}>Suspicious Activity</h1>
        </div>
        <div className="flex gap-2">
          {['unresolved', 'all', 'resolved'].map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg text-sm capitalize ${filter === f ? 'bg-indigo-600 text-white' : dark ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>{f}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><RefreshCw className={`w-6 h-6 animate-spin ${dark ? 'text-gray-400' : 'text-gray-500'}`} /></div>
      ) : activities.length === 0 ? (
        <div className={`text-center py-12 ${dark ? 'text-gray-400' : 'text-gray-500'}`}>
          <Shield className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No suspicious activities detected</p>
        </div>
      ) : (
        <div className="space-y-3">
          {activities.map(a => (
            <div key={a.id} className={`rounded-xl border p-4 ${dark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} ${a.resolved ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${getSeverityColor(a.severity)}`}>{a.severity.toUpperCase()}</span>
                  <div>
                    <p className={`font-medium ${dark ? 'text-white' : 'text-gray-900'}`}>{a.activity_type.replace(/_/g, ' ').toUpperCase()}</p>
                    <p className={`text-sm mt-0.5 ${dark ? 'text-gray-400' : 'text-gray-600'}`}>
                      IP: {a.ip_address} | {a.users?.email || 'N/A'}
                    </p>
                    {a.details && Object.keys(a.details).length > 0 && (
                      <p className={`text-xs mt-1 ${dark ? 'text-gray-500' : 'text-gray-400'}`}>
                        {JSON.stringify(a.details)}
                      </p>
                    )}
                    <p className={`text-xs mt-1 ${dark ? 'text-gray-500' : 'text-gray-400'}`}>
                      {new Date(a.created_at).toLocaleString('en-IN')}
                    </p>
                  </div>
                </div>
                {!a.resolved && (
                  <button onClick={() => resolveActivity(a.id)} className="flex items-center gap-1 px-3 py-1.5 text-sm text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg">
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
          <button onClick={() => fetchActivities(pagination.page + 1)} className="text-sm text-indigo-500 hover:text-indigo-600">Load more</button>
        </div>
      )}
    </div>
  );
}
