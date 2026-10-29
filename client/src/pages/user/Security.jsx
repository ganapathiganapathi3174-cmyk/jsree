import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import { Lock, Globe, Monitor, KeyRound } from 'lucide-react';
import PasswordInput from '../../components/PasswordInput';
import PageHeader from '../../components/PageHeader';
import EmptyState from '../../components/EmptyState';
import LoadingSpinner from '../../components/LoadingSpinner';

export default function Security() {
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changing, setChanging] = useState(false);

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

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) { toast.error('All fields are required'); return; }
    if (newPassword.length < 6) { toast.error('New password must be at least 6 characters'); return; }
    if (newPassword !== confirmPassword) { toast.error('Passwords do not match'); return; }
    if (currentPassword === newPassword) { toast.error('New password must differ from current password'); return; }
    setChanging(true);
    try {
      await api.put('/auth/change-password', { oldPassword: currentPassword, newPassword });
      toast.success('Password changed successfully');
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to change password');
    } finally { setChanging(false); }
  };

  const getEventIcon = (type) => {
    const icons = { login: '🔑', register: '📝', payment: '💳', password_change: '🔒', admin_action: '🛡️' };
    return icons[type] || '📌';
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Security" description="Manage your password and view security activity" />

      <div className="card">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 bg-primary-500/10 text-primary-600 dark:text-primary-400 rounded-xl flex items-center justify-center shrink-0"><KeyRound className="h-5 w-5" aria-hidden="true" /></div>
          <div>
            <h2 className="font-semibold text-ink">Change Password</h2>
            <p className="text-sm text-ink-muted">Update your account password</p>
          </div>
        </div>
        <div className="space-y-4 max-w-md">
          <div>
            <label htmlFor="security-current-password" className="label">Current Password</label>
            <PasswordInput id="security-current-password" placeholder="Enter current password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
          </div>
          <div>
            <label htmlFor="security-new-password" className="label">New Password</label>
            <PasswordInput id="security-new-password" placeholder="Minimum 6 characters" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
          </div>
          <div>
            <label htmlFor="security-confirm-password" className="label">Confirm New Password</label>
            <PasswordInput id="security-confirm-password" placeholder="Re-enter new password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleChangePassword()} />
          </div>
          {newPassword && confirmPassword && newPassword !== confirmPassword && (
            <p className="field-error" role="alert">Passwords do not match</p>
          )}
          <button onClick={handleChangePassword} disabled={changing || !currentPassword || !newPassword || !confirmPassword || newPassword.length < 6 || newPassword !== confirmPassword} className="btn btn-primary">
            {changing ? 'Changing...' : 'Change Password'}
          </button>
        </div>
      </div>

      <div>
        <h2 className="page-subheading">Security Log</h2>
        <p className="text-sm text-ink-muted mt-1">Recent sign-in and security activity</p>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : logs.length === 0 ? (
        <div className="table-shell">
          <EmptyState icon={<Lock className="h-6 w-6" aria-hidden="true" />} title="No activity logged yet" description="Sign-in and security activity will appear here." />
        </div>
      ) : (
        <div className="table-shell divide-y divide-line/70">
          {logs.map(log => (
            <div key={log.id} className="px-4 py-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 hover:bg-surface-2/60 transition-colors">
              <span className="text-xl shrink-0" aria-hidden="true">{getEventIcon(log.event_type)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium capitalize text-ink">{log.event_type.replace(/_/g, ' ')}</p>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  <span className="flex items-center gap-1 text-xs text-ink-faint">
                    <Globe size={12} aria-hidden="true" /> {log.ip_address}
                  </span>
                  {log.user_agent && (
                    <span className="flex items-center gap-1 text-xs text-ink-faint min-w-0">
                      <Monitor size={12} aria-hidden="true" />
                      <span className="truncate max-w-[200px]">{log.user_agent.substring(0, 50)}</span>
                    </span>
                  )}
                </div>
              </div>
              <p className="text-xs whitespace-nowrap text-ink-faint">
                {new Date(log.created_at).toLocaleString('en-IN')}
              </p>
            </div>
          ))}
        </div>
      )}

      {pagination.totalPages > 1 && (
        <div className="text-center">
          <button onClick={() => fetchLogs(pagination.page + 1)} className="btn btn-secondary btn-sm">Load more</button>
        </div>
      )}
    </div>
  );
}
