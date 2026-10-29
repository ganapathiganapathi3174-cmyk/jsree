import { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import { Bell, Check, CheckCheck, Trash2, X, CircleDollarSign, Wallet, Users, Award, Settings, Info } from 'lucide-react';

const ICONS = {
  payment_approved: { icon: Check, cls: 'text-success-600 bg-success-500/10' },
  payment_rejected: { icon: X, cls: 'text-error-600 bg-error-500/10' },
  plan_change_approved: { icon: Check, cls: 'text-success-600 bg-success-500/10' },
  plan_change_rejected: { icon: X, cls: 'text-error-600 bg-error-500/10' },
  wallet_credit: { icon: CircleDollarSign, cls: 'text-success-600 bg-success-500/10' },
  wallet_debit: { icon: Wallet, cls: 'text-warning-600 bg-warning-500/10' },
  referral_activated: { icon: Users, cls: 'text-primary-600 bg-primary-500/10' },
  referral_deactivated: { icon: Users, cls: 'text-ink-muted bg-surface-2' },
  tier_upgrade: { icon: Award, cls: 'text-accent-500 bg-accent-500/10' },
  admin_reactivation: { icon: Settings, cls: 'text-info-600 bg-info-500/10' },
  system: { icon: Info, cls: 'text-info-600 bg-info-500/10' },
};

function NotificationIcon({ type }) {
  const conf = ICONS[type] || ICONS.system;
  const Icon = conf.icon;
  return (
    <span className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${conf.cls}`}>
      <Icon size={16} />
    </span>
  );
}

export default function NotificationPanel() {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const { data } = await api.get('/notifications/unread-count');
      setUnreadCount(data.count);
    } catch (e) { /* ignore — non-critical */ }
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
    } catch (e) { /* ignore — non-critical */ }
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

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="btn btn-ghost btn-icon btn-sm relative"
        aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
        aria-expanded={open}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-error-600 text-white text-[10px] rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center font-bold leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-[calc(100vw-2rem)] sm:w-96 rounded-lg shadow-elevation z-50 border border-line bg-surface overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-line">
              <h3 className="font-semibold text-ink text-sm">Notifications</h3>
              <div className="flex items-center gap-3">
                {unreadCount > 0 && (
                  <button onClick={markAllRead} className="flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline">
                    <CheckCheck size={14} /> Mark all read
                  </button>
                )}
                <button onClick={() => setOpen(false)} className="btn btn-ghost btn-icon btn-sm" aria-label="Close notifications">
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="py-10 text-center">
                  <Bell className="h-6 w-6 text-ink-faint mx-auto mb-2" />
                  <p className="text-sm text-ink-muted">No notifications yet</p>
                </div>
              ) : (
                notifications.map(n => (
                  <div
                    key={n.id}
                    className={`px-4 py-3 border-b border-line/70 cursor-pointer transition-colors hover:bg-surface-2/70 ${
                      !n.read ? 'bg-primary-500/[0.06]' : ''
                    }`}
                    onClick={() => !n.read && markAsRead(n.id)}
                  >
                    <div className="flex items-start gap-3">
                      <NotificationIcon type={n.type} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-ink">{n.title}</p>
                        <p className="text-xs mt-0.5 text-ink-muted">{n.message}</p>
                        <p className="text-xs mt-1 text-ink-faint">
                          {new Date(n.created_at).toLocaleString('en-IN')}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        {!n.read && <span className="w-2 h-2 bg-primary-500 rounded-full" aria-label="Unread" />}
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteNotification(n.id); }}
                          className="p-1 rounded text-ink-faint hover:text-error-600 hover:bg-error-500/10"
                          aria-label="Delete notification"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            {hasMore && (
              <div className="px-4 py-2.5 border-t border-line text-center">
                <button onClick={loadMore} className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline">
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
