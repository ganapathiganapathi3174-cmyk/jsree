import { useState, useEffect } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import api from '../../utils/api';
import { Lock, Globe, Monitor, RefreshCw } from 'lucide-react';

export default function Security() {
  const { dark } = useTheme();
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
      <div className="flex items-center gap-3">
        <Lock className={`w-8 h-8 ${dark ? 'text-indigo-400' : 'text-indigo-600'}`} />
        <h1 className={`text-2xl font-bold ${dark ? 'text-white' : 'text-gray-900'}`}>Security Log</h1>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><RefreshCw className={`w-6 h-6 animate-spin ${dark ? 'text-gray-400' : 'text-gray-500'}`} /></div>
      ) : logs.length === 0 ? (
        <div className={`text-center py-12 ${dark ? 'text-gray-400' : 'text-gray-500'}`}>
          <Lock className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No activity logged yet</p>
        </div>
      ) : (
        <div className={`rounded-xl border overflow-hidden ${dark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
          <div className={`divide-y ${dark ? 'divide-gray-700' : 'divide-gray-100'}`}>
            {logs.map(log => (
              <div key={log.id} className={`px-4 py-3 flex items-center gap-4 ${dark ? 'hover:bg-gray-750' : 'hover:bg-gray-50'}`}>
                <span className="text-xl">{getEventIcon(log.event_type)}</span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium capitalize ${dark ? 'text-white' : 'text-gray-900'}`}>{log.event_type.replace(/_/g, ' ')}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className={`flex items-center gap-1 text-xs ${dark ? 'text-gray-400' : 'text-gray-500'}`}>
                      <Globe size={12} /> {log.ip_address}
                    </span>
                    {log.user_agent && (
                      <span className={`flex items-center gap-1 text-xs truncate max-w-xs ${dark ? 'text-gray-400' : 'text-gray-500'}`}>
                        <Monitor size={12} /> {log.user_agent.substring(0, 50)}
                      </span>
                    )}
                  </div>
                </div>
                <p className={`text-xs whitespace-nowrap ${dark ? 'text-gray-500' : 'text-gray-400'}`}>
                  {new Date(log.created_at).toLocaleString('en-IN')}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {pagination.totalPages > 1 && (
        <div className="text-center">
          <button onClick={() => fetchLogs(pagination.page + 1)} className="text-sm text-indigo-500 hover:text-indigo-600">Load more</button>
        </div>
      )}
    </div>
  );
}
