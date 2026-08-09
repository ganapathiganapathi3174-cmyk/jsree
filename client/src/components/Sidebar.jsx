import { NavLink, useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import {
  LayoutDashboard, User, CreditCard, ArrowUpDown, Users, RefreshCw,
  MessageSquare, History, Shield, LogOut, X, UserX, FileText,
  ClipboardList, ScrollText, Wallet, Bell, Receipt, Lock, BarChart3, AlertTriangle,
} from 'lucide-react';

const userLinks = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/dashboard/profile', icon: User, label: 'Profile' },
  { to: '/dashboard/payment', icon: CreditCard, label: 'Payment' },
  { to: '/dashboard/topups', icon: ArrowUpDown, label: 'Top-Ups' },
  { to: '/dashboard/referrals', icon: Users, label: 'Referrals' },
  { to: '/dashboard/plan-change', icon: RefreshCw, label: 'Change Plan' },
  { to: '/dashboard/wallet', icon: Wallet, label: 'Wallet' },
  { to: '/dashboard/notifications', icon: Bell, label: 'Notifications' },
  { to: '/dashboard/receipts', icon: Receipt, label: 'Receipts' },
  { to: '/dashboard/chat', icon: MessageSquare, label: 'Chat' },
  { to: '/dashboard/history', icon: History, label: 'History' },
  { to: '/dashboard/security', icon: Lock, label: 'Security' },
];

const adminLinks = [
  { to: '/admin', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/admin/users', icon: Users, label: 'Users' },
  { to: '/admin/payments', icon: CreditCard, label: 'Payments' },
  { to: '/admin/topups', icon: ArrowUpDown, label: 'Top-Ups' },
  { to: '/admin/inactive-users', icon: UserX, label: 'Inactive Users' },
  { to: '/admin/plan-changes', icon: ClipboardList, label: 'Plan Changes' },
  { to: '/admin/financial-reports', icon: BarChart3, label: 'Financial Reports' },
  { to: '/admin/suspicious-activity', icon: AlertTriangle, label: 'Suspicious Activity' },
  { to: '/admin/chat', icon: MessageSquare, label: 'Chat' },
  { to: '/admin/audit-logs', icon: ScrollText, label: 'Audit Logs' },
];

export default function Sidebar({ isOpen, onClose, isAdmin, currentPath }) {
  const navigate = useNavigate();
  const { dark } = useTheme();
  const links = isAdmin ? adminLinks : userLinks;

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    onClose();
    navigate(isAdmin ? '/admin/login' : '/login');
  };

  const isActive = (to) => {
    if (to === '/dashboard' || to === '/admin') return currentPath === to;
    return currentPath.startsWith(to);
  };

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden transition-opacity" onClick={onClose} />
      )}

      <aside className={`fixed top-0 left-0 z-50 h-full w-64 ${dark ? 'bg-gray-800 border-r border-gray-700' : 'bg-white border-r border-gray-200'} transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:z-auto ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className={`flex items-center justify-between p-4 border-b ${dark ? 'border-gray-700' : 'border-gray-100'}`}>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <Shield size={18} className="text-white" />
            </div>
            <span className={`font-bold ${dark ? 'text-white' : 'text-gray-900'}`}>
              {isAdmin ? 'Admin Panel' : 'ReferralHub'}
            </span>
          </div>
          <button onClick={onClose} className={`lg:hidden p-1 rounded-lg ${dark ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}>
            <X size={20} />
          </button>
        </div>

        <nav className="p-3 space-y-1 overflow-y-auto h-[calc(100%-140px)]">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === '/dashboard' || link.to === '/admin'}
              onClick={onClose}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive(link.to)
                  ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400'
                  : dark ? 'text-gray-400 hover:bg-gray-700 hover:text-white' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <link.icon size={18} />
              <span>{link.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className={`absolute bottom-0 left-0 right-0 p-3 border-t ${dark ? 'border-gray-700 bg-gray-800' : 'border-gray-100 bg-white'}`}>
          <button onClick={handleLogout} className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
            <LogOut size={18} />
            <span>Logout</span>
          </button>
        </div>
      </aside>
    </>
  );
}
