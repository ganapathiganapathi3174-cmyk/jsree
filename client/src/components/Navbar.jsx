import { Menu, ChevronDown, LogOut, User as UserIcon, Shield } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import ThemeToggle from './ThemeToggle';
import NotificationPanel from './NotificationPanel';
import Avatar from './Avatar';
import api from '../utils/api';

export function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}

// Friendly labels for auto-generated breadcrumbs.
const CRUMB_LABELS = {
  dashboard: 'Dashboard',
  profile: 'Profile',
  payment: 'Payment',
  topups: 'Top-Ups',
  referrals: 'Referrals',
  'plan-change': 'Change Plan',
  chat: 'Chat',
  history: 'History',
  wallet: 'Wallet',
  notifications: 'Notifications',
  receipts: 'Receipts',
  security: 'Security',
  users: 'Users',
  payments: 'Payments',
  'inactive-users': 'Inactive Users',
  'plan-changes': 'Plan Changes',
  'audit-logs': 'Audit Logs',
  'financial-reports': 'Financial Reports',
  'suspicious-activity': 'Suspicious Activity',
  'payment-settings': 'Payment Settings',
};

export default function Navbar({ onMenuToggle, isAdmin }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const userStr = localStorage.getItem('user');
  const [user, setUser] = useState(userStr ? JSON.parse(userStr) : null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token || isAdmin) return;
    api.get('/users/profile')
      .then((r) => {
        const fresh = r.data.data;
        localStorage.setItem('user', JSON.stringify(fresh));
        setUser(fresh);
      })
      .catch(() => {});
  }, [isAdmin]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = () => {
    logout();
    toast.success('Logged out successfully');
    navigate(isAdmin ? '/admin/login' : '/login');
  };

  const parts = location.pathname.split('/').filter(Boolean);
  const breadcrumbs = parts.map((part, i) => ({
    label: CRUMB_LABELS[part] || part.charAt(0).toUpperCase() + part.slice(1).replace(/-/g, ' '),
    isLast: i === parts.length - 1,
  }));

  return (
    <header className="bg-surface/85 backdrop-blur-xl border-b border-line sticky top-0 z-30">
      <div className="flex items-center justify-between gap-3 px-4 sm:px-6 h-16">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onMenuToggle}
            className="btn btn-ghost btn-icon btn-sm lg:hidden"
            aria-label="Toggle navigation menu"
          >
            <Menu size={20} />
          </button>
          <nav aria-label="Breadcrumb" className="hidden sm:flex items-center gap-2 text-sm min-w-0">
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-2 min-w-0">
                {i > 0 && (
                  <span className="text-ink-faint" aria-hidden="true">
                    /
                  </span>
                )}
                <span
                  className={
                    crumb.isLast
                      ? 'text-ink font-semibold truncate'
                      : 'text-ink-muted truncate'
                  }
                  aria-current={crumb.isLast ? 'page' : undefined}
                >
                  {crumb.label}
                </span>
              </span>
            ))}
          </nav>
          <span className="sm:hidden text-sm font-semibold text-ink truncate">
            {isAdmin ? 'JSREE Admin' : 'JSREE'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {!isAdmin && <NotificationPanel />}
          <ThemeToggle />
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen((v) => !v)}
              className="flex items-center gap-2 pl-1.5 pr-2 py-1.5 rounded-lg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/50"
              aria-haspopup="menu"
              aria-expanded={dropdownOpen}
              aria-label="Account menu"
            >
              <Avatar user={user} size={32} />
              <div className="hidden sm:block text-left max-w-[10rem]">
                <p className="text-sm font-medium text-ink leading-tight truncate">
                  {user?.fullName || user?.name || 'User'}
                </p>
                <p className="text-xs capitalize text-ink-faint leading-tight truncate">
                  {user?.role || 'user'}
                </p>
              </div>
              <ChevronDown
                size={15}
                className={`hidden sm:block text-ink-faint transition-transform duration-150 ${
                  dropdownOpen ? 'rotate-180' : ''
                }`}
                aria-hidden="true"
              />
            </button>

            {dropdownOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-2 w-52 rounded-lg shadow-elevation border border-line py-1 z-50 bg-surface overflow-hidden"
              >
                <div className="px-4 py-2.5 border-b border-line sm:hidden">
                  <p className="text-sm font-medium text-ink truncate">
                    {user?.fullName || user?.name || 'User'}
                  </p>
                  <p className="text-xs capitalize text-ink-faint">{user?.role || 'user'}</p>
                </div>
                {!isAdmin && (
                  <button
                    role="menuitem"
                    onClick={() => {
                      setDropdownOpen(false);
                      navigate('/dashboard/profile');
                    }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-ink-muted hover:bg-surface-2 hover:text-ink transition-colors"
                  >
                    <UserIcon size={16} /> Profile
                  </button>
                )}
                {isAdmin && (
                  <div className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-ink-muted">
                    <Shield size={16} /> Admin session
                  </div>
                )}
                <button
                  role="menuitem"
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-error-600 dark:text-error-400 hover:bg-error-500/10 transition-colors"
                >
                  <LogOut size={16} /> Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
