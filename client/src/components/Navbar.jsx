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
    <header className={`${dark ? 'bg-gray-800 border-b border-gray-700' : 'bg-white border-b border-gray-200'} sticky top-0 z-30`}>
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={onMenuToggle} className={`lg:hidden p-2 rounded-lg ${dark ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-600'}`}>
            <Menu size={20} />
          </button>
          <div className="hidden sm:flex items-center gap-2 text-sm">
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-2">
                {i > 0 && <span className={dark ? 'text-gray-600' : 'text-gray-300'}>/</span>}
                <span className={crumb.isLast ? (dark ? 'text-white font-medium' : 'text-gray-900 font-medium') : (dark ? 'text-gray-400' : 'text-gray-500')}>
                  {crumb.label}
                </span>
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isAdmin && <NotificationPanel />}
          <ThemeToggle />
          <span className="hidden sm:block text-sm font-bold tracking-wide text-indigo-600 dark:text-indigo-400">
            {isAdmin ? 'JSREE ADMIN' : 'JSREE'}
          </span>
          <div className="relative" ref={dropdownRef}>
            <button onClick={() => setDropdownOpen(!dropdownOpen)} className={`flex items-center gap-2 p-1.5 rounded-lg transition-colors ${dark ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}>
              <Avatar user={user} size={36} />
              <div className="hidden sm:block text-left">
                <p className={`text-sm font-medium ${dark ? 'text-white' : 'text-gray-700'}`}>
                  {user?.fullName || user?.name || 'User'}
                </p>
                <p className={`text-xs capitalize ${dark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {user?.role || 'user'}
                </p>
              </div>
              <ChevronDown size={16} className={`hidden sm:block ${dark ? 'text-gray-500' : 'text-gray-400'}`} />
            </button>

            {dropdownOpen && (
              <div className={`absolute right-0 top-full mt-2 w-48 rounded-xl shadow-lg py-1 z-50 ${dark ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200'}`}>
                {!isAdmin && (
                  <button onClick={() => { setDropdownOpen(false); navigate('/dashboard/profile'); }} className={`w-full flex items-center gap-2 px-4 py-2 text-sm ${dark ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-50'}`}>
                    <UserIcon size={16} /> Profile
                  </button>
                )}
                <button onClick={handleLogout} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
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
