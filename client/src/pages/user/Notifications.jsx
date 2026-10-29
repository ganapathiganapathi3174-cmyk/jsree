import { useState, useEffect } from 'react';
import api from '../../utils/api';
import { Bell, CheckCheck, Trash2 } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import EmptyState from '../../components/EmptyState';
import LoadingSpinner from '../../components/LoadingSpinner';

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
      <PageHeader
        title="Notifications"
        description="Updates on your account activity"
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => setUnreadOnly(!unreadOnly)} aria-pressed={unreadOnly} className={`chip ${unreadOnly ? 'chip-active' : ''}`}>
              {unreadOnly ? 'Unread Only' : 'All'}
            </button>
            <button onClick={markAllRead} className="btn btn-secondary"><CheckCheck className="h-4 w-4" aria-hidden="true" /> Mark all read</button>
          </div>
        }
      />

      {loading ? (
        <LoadingSpinner />
      ) : notifications.length === 0 ? (
        <div className="table-shell">
          <EmptyState icon={<Bell className="h-6 w-6" aria-hidden="true" />} title="No notifications" description="Updates about your account will appear here." />
        </div>
      ) : (
        <div className="table-shell divide-y divide-line/70">
          {notifications.map(n => (
            <div key={n.id} className={`p-4 flex items-start gap-3 ${!n.read ? 'bg-primary-500/5' : ''}`}>
              <span className="text-xl mt-0.5 shrink-0" aria-hidden="true">{getIcon(n.type)}</span>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-ink">{n.title}</p>
                <p className="text-sm mt-0.5 text-ink-muted">{n.message}</p>
                <p className="text-xs mt-1 text-ink-faint">{new Date(n.created_at).toLocaleString('en-IN')}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!n.read && <>
                  <button onClick={() => markRead(n.id)} className="link text-xs">Mark read</button>
                  <span className="w-2 h-2 bg-primary-600 rounded-full" aria-hidden="true" />
                </>}
                <button onClick={() => deleteNotif(n.id)} className="btn btn-ghost btn-icon" aria-label="Delete notification"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {pagination.totalPages > 1 && (
        <div className="text-center">
          <button onClick={() => fetchNotifications(pagination.page + 1)} className="btn btn-secondary btn-sm">Load more</button>
        </div>
      )}
    </div>
  );
}
