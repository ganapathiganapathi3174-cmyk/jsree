import { useState, useEffect } from 'react';
import api from '../../utils/api';
import { Lock, Globe, Monitor, RefreshCw } from 'lucide-react';

export default function Security() {
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1 });
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchLogs(1); }, []);

  const fetchLogs = async (page = 1) => {
    setLoading(true);
    try {
      const { data } = await api.get(`/security/ip-history?page=${page}&limit=20`);
      if (page === 1) setLogs(data.logs);
      else setLogs(prev => [...prev, ...data.logs]);
      setPagination(data.pagination);
    } catch (e) { /* ignore */ }
    setLoading(false);
  };

  const getEventIcon = (type) => {
    const icons = { login: '🔑', register: '📝', payment: '💳', password_change: '🔒', admin_action: '🛡️' };
    return icons[type] || '📌';
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Security Log</h1>
        <p className="text-sm text-gray-500 mt-1">Recent sign-in and security activity</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><RefreshCw className="w-6 h-6 animate-spin text-gray-500" /></div>
      ) : logs.length === 0 ? (
        <div className="table-shell text-center py-12 text-gray-500">
          <Lock className="w-12 h-12 mx-auto mb-3 opacity-50 text-gray-300" />
          <p>No activity logged yet</p>
        </div>
      ) : (
        <div className="table-shell overflow-hidden divide-y divide-gray-100">
          {logs.map(log => (
            <div key={log.id} className="px-4 py-3 flex items-center gap-4 hover:bg-gray-50 transition-colors">
              <span className="text-xl">{getEventIcon(log.event_type)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium capitalize text-gray-900">{log.event_type.replace(/_/g, ' ')}</p>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  <span className="flex items-center gap-1 text-xs text-gray-500">
                    <Globe size={12} /> {log.ip_address}
                  </span>
                  {log.user_agent && (
                    <span className="flex items-center gap-1 text-xs text-gray-500 truncate max-w-[200px]">
                      <Monitor size={12} /> {log.user_agent.substring(0, 50)}
                    </span>
                  )}
                </div>
              </div>
              <p className="text-xs whitespace-nowrap text-gray-400">
                {new Date(log.created_at).toLocaleString('en-IN')}
              </p>
            </div>
          ))}
        </div>
      )}

      {pagination.totalPages > 1 && (
        <div className="text-center">
          <button onClick={() => fetchLogs(pagination.page + 1)} className="text-sm font-medium text-primary-600 hover:text-primary-700">Load more</button>
        </div>
      )}
    </div>
  );
}