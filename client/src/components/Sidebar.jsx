import { NavLink, useNavigate } from 'react-router-dom';
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
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed top-0 left-0 z-50 h-full w-64 bg-slate-950/80 backdrop-blur-2xl border-r border-slate-500/15 shadow-elevation lg:shadow-none flex flex-col transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:z-auto ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label={isAdmin ? 'Admin navigation' : 'Account navigation'}
      >
        <div className="flex items-center justify-between px-5 h-16 border-b border-slate-500/10 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-gradient-to-br from-primary-500 to-accent-500 rounded-xl flex items-center justify-center shadow-glow-sm">
              <Shield size={18} className="text-white" />
            </div>
            <div className="leading-tight">
              <span className="block font-bold tracking-tight text-slate-50 leading-none">
                {isAdmin ? 'JSREE Admin' : 'JSREE'}
              </span>
              <span className="block text-[11px] text-slate-400 mt-0.5">Membership Portal</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden p-1.5 rounded-lg hover:bg-white/10 text-slate-400"
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === '/dashboard' || link.to === '/admin'}
              onClick={onClose}
              className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
                isActive(link.to)
                  ? 'bg-primary-500/15 text-primary-300 shadow-glow-sm'
                  : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-100 hover:shadow-glow-sm'
              }`}
            >
              {isActive(link.to) && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 rounded-r-full bg-primary-400 shadow-glow" />
              )}
              <link.icon size={18} className={isActive(link.to) ? 'text-primary-400' : 'text-slate-500'} />
              <span>{link.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-slate-500/10 shrink-0">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium text-slate-400 hover:bg-error-600/10 hover:text-error-400 transition-colors"
          >
            <LogOut size={18} />
            <span>Logout</span>
          </button>
        </div>
      </aside>
    </>
  );
}