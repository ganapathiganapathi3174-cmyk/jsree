import { useState, useEffect } from 'react';
import api from '../../utils/api';
import { Bell, CheckCheck, Trash2, RefreshCw } from 'lucide-react';

export default function Notifications() {
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
          <p className="text-sm text-gray-500 mt-1">Updates on your account activity</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setUnreadOnly(!unreadOnly)} className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors border ${unreadOnly ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
            {unreadOnly ? 'Unread Only' : 'All'}
          </button>
          <button onClick={markAllRead} className="btn-secondary py-1.5 text-sm"><CheckCheck size={16} /> Mark all read</button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><RefreshCw className="w-6 h-6 animate-spin text-gray-500" /></div>
      ) : notifications.length === 0 ? (
        <div className="table-shell text-center py-12 text-gray-500">
          <Bell className="w-12 h-12 mx-auto mb-3 opacity-50 text-gray-300" />
          <p>No notifications</p>
        </div>
      ) : (
        <div className="table-shell overflow-hidden divide-y divide-gray-100">
          {notifications.map(n => (
            <div key={n.id} className={`p-4 flex items-start gap-3 ${!n.read ? 'bg-primary-50/40' : ''}`}>
              <span className="text-xl mt-0.5">{getIcon(n.type)}</span>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900">{n.title}</p>
                <p className="text-sm mt-0.5 text-gray-600">{n.message}</p>
                <p className="text-xs mt-1 text-gray-400">{new Date(n.created_at).toLocaleString('en-IN')}</p>
              </div>
              <div className="flex items-center gap-2">
                {!n.read && <>
                  <button onClick={() => markRead(n.id)} className="text-xs text-primary-600 hover:underline font-medium">Mark read</button>
                  <span className="w-2 h-2 bg-primary-600 rounded-full" />
                </>}
                <button onClick={() => deleteNotif(n.id)} className="p-1 rounded text-gray-400 hover:bg-gray-100" aria-label="Delete notification"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {pagination.totalPages > 1 && (
        <div className="text-center">
          <button onClick={() => fetchNotifications(pagination.page + 1)} className="text-sm font-medium text-primary-600 hover:text-primary-700">Load more</button>
        </div>
      )}
    </div>
  );
}