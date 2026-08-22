import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import { Lock, Globe, Monitor, RefreshCw, KeyRound } from 'lucide-react';
import PasswordInput from '../../components/PasswordInput';

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
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Security</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your password and view security activity</p>
      </div>

      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-primary-50 text-primary-500 rounded-xl flex items-center justify-center"><KeyRound className="h-5 w-5" /></div>
          <div>
            <h3 className="font-semibold text-gray-900">Change Password</h3>
            <p className="text-sm text-gray-500">Update your account password</p>
          </div>
        </div>
        <div className="space-y-4 max-w-md">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
            <PasswordInput placeholder="Enter current password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
            <PasswordInput placeholder="Minimum 6 characters" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
            <PasswordInput placeholder="Re-enter new password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleChangePassword()} />
          </div>
          {newPassword && confirmPassword && newPassword !== confirmPassword && (
            <p className="text-xs text-red-600">Passwords do not match</p>
          )}
          <button onClick={handleChangePassword} disabled={changing || !currentPassword || !newPassword || !confirmPassword || newPassword.length < 6 || newPassword !== confirmPassword} className="btn-primary">
            {changing ? 'Changing...' : 'Change Password'}
          </button>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Security Log</h2>
        <p className="text-sm text-gray-500 mb-4">Recent sign-in and security activity</p>
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