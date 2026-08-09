import { useState, useEffect, useCallback } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import api from '../utils/api';
import { Bell, Check, CheckCheck, Trash2, X } from 'lucide-react';

export default function NotificationPanel() {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const { dark } = useTheme();

  const fetchUnreadCount = useCallback(async () => {
    try {
      const { data } = await api.get('/notifications/unread-count');
      setUnreadCount(data.count);
    } catch (e) { /* ignore */ }
  }, []);

  const fetchNotifications = useCallback(async (p = 1) => {
    try {
      const { data } = await api.get(`/notifications?page=${p}&limit=10`);
      if (p === 1) {
        setNotifications(data.notifications);
      } else {
        setNotifications(prev => [...prev, ...data.notifications]);
      }
      setHasMore(data.pagination.page < data.pagination.totalPages);
    } catch (e) { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  useEffect(() => {
    if (open) {
      fetchNotifications(1);
      setPage(1);
    }
  }, [open, fetchNotifications]);

  const markAsRead = async (id) => {
    try {
      await api.put(`/notifications/${id}/read`);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (e) { /* ignore */ }
  };

  const markAllRead = async () => {
    try {
      await api.put('/notifications/read-all');
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (e) { /* ignore */ }
  };

  const deleteNotification = async (id) => {
    try {
      await api.delete(`/notifications/${id}`);
      setNotifications(prev => prev.filter(n => n.id !== id));
    } catch (e) { /* ignore */ }
  };

  const loadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchNotifications(nextPage);
  };

  const getIcon = (type) => {
    const icons = {
      payment_approved: '✅', payment_rejected: '❌', wallet_credit: '💰',
      referral_activated: '👥', tier_upgrade: '🏆', system: '📢',
      plan_change_approved: '✅', plan_change_rejected: '❌',
      referral_deactivated: '⏸️', wallet_debit: '💸', admin_reactivation: '🔄'
    };
    return icons[type] || '📢';
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`relative p-2 rounded-lg transition-colors ${dark ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-100 text-gray-600'}`}
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className={`absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-xl shadow-2xl z-50 border ${dark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
            <div className={`flex items-center justify-between px-4 py-3 border-b ${dark ? 'border-gray-700' : 'border-gray-200'}`}>
              <h3 className={`font-semibold ${dark ? 'text-white' : 'text-gray-900'}`}>Notifications</h3>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button onClick={markAllRead} className="text-xs text-indigo-500 hover:text-indigo-600 flex items-center gap-1">
                    <CheckCheck size={14} /> Mark all read
                  </button>
                )}
                <button onClick={() => setOpen(false)} className={`p-1 rounded ${dark ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}>
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className={`py-8 text-center text-sm ${dark ? 'text-gray-400' : 'text-gray-500'}`}>
                  No notifications yet
                </div>
              ) : (
                notifications.map(n => (
                  <div
                    key={n.id}
                    className={`px-4 py-3 border-b cursor-pointer transition-colors ${dark ? 'border-gray-700 hover:bg-gray-750' : 'border-gray-100 hover:bg-gray-50'} ${!n.read ? (dark ? 'bg-gray-750' : 'bg-indigo-50') : ''}`}
                    onClick={() => !n.read && markAsRead(n.id)}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-lg mt-0.5">{getIcon(n.type)}</span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${dark ? 'text-white' : 'text-gray-900'}`}>{n.title}</p>
                        <p className={`text-xs mt-0.5 ${dark ? 'text-gray-400' : 'text-gray-500'}`}>{n.message}</p>
                        <p className={`text-xs mt-1 ${dark ? 'text-gray-500' : 'text-gray-400'}`}>
                          {new Date(n.created_at).toLocaleString('en-IN')}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        {!n.read && <span className="w-2 h-2 bg-indigo-500 rounded-full" />}
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteNotification(n.id); }}
                          className={`p-1 rounded opacity-0 group-hover:opacity-100 ${dark ? 'hover:bg-gray-700 text-gray-500' : 'hover:bg-gray-200 text-gray-400'}`}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            {hasMore && (
              <div className={`px-4 py-2 border-t text-center ${dark ? 'border-gray-700' : 'border-gray-200'}`}>
                <button onClick={loadMore} className="text-sm text-indigo-500 hover:text-indigo-600">
                  Load more
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
