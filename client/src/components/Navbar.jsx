import { Menu, ChevronDown, LogOut, User as UserIcon } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useTheme } from '../contexts/ThemeContext';
import ThemeToggle from './ThemeToggle';
import NotificationPanel from './NotificationPanel';
import Avatar from './Avatar';
import api from '../utils/api';

export function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}

export default function Navbar({ onMenuToggle, isAdmin }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { dark } = useTheme();
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

  const getBreadcrumbs = () => {
    const parts = location.pathname.split('/').filter(Boolean);
    return parts.map((part, i) => ({
      label: part.charAt(0).toUpperCase() + part.slice(1).replace(/-/g, ' '),
      isLast: i === parts.length - 1,
    }));
  };

  const breadcrumbs = getBreadcrumbs();

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
      <div className="flex items-center justify-between px-4 sm:px-6 h-16">
        <div className="flex items-center gap-3">
          <button onClick={onMenuToggle} className="lg:hidden p-2 rounded-lg text-gray-600 hover:bg-gray-100" aria-label="Toggle menu">
            <Menu size={20} />
          </button>
          <div className="hidden sm:flex items-center gap-2 text-sm">
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-2">
                {i > 0 && <span className="text-gray-300">/</span>}
                <span className={crumb.isLast ? 'text-gray-900 font-semibold' : 'text-gray-500'}>
                  {crumb.label}
                </span>
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isAdmin && <NotificationPanel />}
          <ThemeToggle />
          <span className="hidden sm:block text-sm font-bold tracking-wide text-primary-600">
            {isAdmin ? 'JSREE ADMIN' : 'JSREE'}
          </span>
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-2 p-1.5 rounded-lg transition-colors hover:bg-gray-50"
            >
              <Avatar user={user} size={36} />
              <div className="hidden sm:block text-left">
                <p className="text-sm font-medium text-gray-700 leading-tight">
                  {user?.fullName || user?.name || 'User'}
                </p>
                <p className="text-xs capitalize text-gray-400 leading-tight">
                  {user?.role || 'user'}
                </p>
              </div>
              <ChevronDown size={16} className="hidden sm:block text-gray-400" />
            </button>

            {dropdownOpen && (
              <div className="absolute right-0 top-full mt-2 w-48 rounded-xl shadow-lg shadow-slate-200/60 border border-gray-200 py-1 z-50 bg-white">
                {!isAdmin && (
                  <button
                    onClick={() => { setDropdownOpen(false); navigate('/dashboard/profile'); }}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <UserIcon size={16} /> Profile
                  </button>
                )}
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-error-600 hover:bg-error-50"
                >
                  <LogOut size={16} /> Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}