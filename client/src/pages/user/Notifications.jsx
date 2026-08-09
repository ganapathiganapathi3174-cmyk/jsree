import { useState, useEffect } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import api from '../../utils/api';
import { Bell, CheckCheck, Trash2, RefreshCw } from 'lucide-react';

export default function Notifications() {
  const { dark } = useTheme();
  const [notifications, setNotifications] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [unreadOnly, setUnreadOnly] = useState(false);

  useEffect(() => { fetchNotifications(1); }, [unreadOnly]);

  const fetchNotifications = async (page = 1) => {
    setLoading(true);
    try {
      const { data } = await api.get(`/notifications?page=${page}&limit=20&unreadOnly=${unreadOnly}`);
      if (page === 1) setNotifications(data.notifications);
      else setNotifications(prev => [...prev, ...data.notifications]);
      setPagination(data.pagination);
    } catch (e) { /* ignore */ }
    setLoading(false);
  };

  const markRead = async (id) => {
    await api.put(`/notifications/${id}/read`);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const markAllRead = async () => {
    await api.put('/notifications/read-all');
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const deleteNotif = async (id) => {
    await api.delete(`/notifications/${id}`);
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const getIcon = (type) => {
    const icons = { payment_approved: '✅', payment_rejected: '❌', wallet_credit: '💰', referral_activated: '👥', tier_upgrade: '🏆', system: '📢', plan_change_approved: '✅', plan_change_rejected: '❌', referral_deactivated: '⏸️', wallet_debit: '💸', admin_reactivation: '🔄' };
    return icons[type] || '📢';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bell className={`w-8 h-8 ${dark ? 'text-indigo-400' : 'text-indigo-600'}`} />
          <h1 className={`text-2xl font-bold ${dark ? 'text-white' : 'text-gray-900'}`}>Notifications</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setUnreadOnly(!unreadOnly)} className={`px-3 py-1.5 rounded-lg text-sm ${unreadOnly ? 'bg-indigo-600 text-white' : dark ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>
            {unreadOnly ? 'Unread Only' : 'All'}
          </button>
          <button onClick={markAllRead} className="flex items-center gap-1 px-3 py-1.5 text-sm text-indigo-500 hover:text-indigo-600">
            <CheckCheck size={16} /> Mark all read
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><RefreshCw className={`w-6 h-6 animate-spin ${dark ? 'text-gray-400' : 'text-gray-500'}`} /></div>
      ) : notifications.length === 0 ? (
        <div className={`text-center py-12 ${dark ? 'text-gray-400' : 'text-gray-500'}`}>
          <Bell className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No notifications</p>
        </div>
      ) : (
        <div className={`rounded-xl border divide-y ${dark ? 'bg-gray-800 border-gray-700 divide-gray-700' : 'bg-white border-gray-200 divide-gray-100'}`}>
          {notifications.map(n => (
            <div key={n.id} className={`p-4 flex items-start gap-3 ${!n.read ? (dark ? 'bg-gray-750' : 'bg-indigo-50/50') : ''}`}>
              <span className="text-xl mt-0.5">{getIcon(n.type)}</span>
              <div className="flex-1 min-w-0">
                <p className={`font-medium ${dark ? 'text-white' : 'text-gray-900'}`}>{n.title}</p>
                <p className={`text-sm mt-0.5 ${dark ? 'text-gray-400' : 'text-gray-600'}`}>{n.message}</p>
                <p className={`text-xs mt-1 ${dark ? 'text-gray-500' : 'text-gray-400'}`}>{new Date(n.created_at).toLocaleString('en-IN')}</p>
              </div>
              <div className="flex items-center gap-1">
                {!n.read && <button onClick={() => markRead(n.id)} className="text-xs text-indigo-500 hover:underline">Mark read</button>}
                <button onClick={() => deleteNotif(n.id)} className={`p-1 rounded ${dark ? 'hover:bg-gray-700 text-gray-500' : 'hover:bg-gray-100 text-gray-400'}`}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {pagination.totalPages > 1 && (
        <div className="text-center">
          <button onClick={() => fetchNotifications(pagination.page + 1)} className="text-sm text-indigo-500 hover:text-indigo-600">Load more</button>
        </div>
      )}
    </div>
  );
}
