import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, User, CreditCard, ArrowUpDown, Users, RefreshCw,
  MessageSquare, History, Shield, LogOut, X, UserX, FileText,
  ClipboardList, ScrollText, Wallet, Bell, Receipt, Lock, BarChart3, AlertTriangle, Settings,
} from 'lucide-react';

// Grouped navigation keeps the sidebar scannable.
const userGroups = [
  {
    label: 'Overview',
    links: [{ to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', end: true }],
  },
  {
    label: 'Payments',
    links: [
      { to: '/dashboard/payment', icon: CreditCard, label: 'Payment' },
      { to: '/dashboard/topups', icon: ArrowUpDown, label: 'Top-Ups' },
      { to: '/dashboard/wallet', icon: Wallet, label: 'Wallet' },
      { to: '/dashboard/receipts', icon: Receipt, label: 'Receipts' },
    ],
  },
  {
    label: 'Account',
    links: [
      { to: '/dashboard/profile', icon: User, label: 'Profile' },
      { to: '/dashboard/referrals', icon: Users, label: 'Referrals' },
      { to: '/dashboard/plan-change', icon: RefreshCw, label: 'Change Plan' },
      { to: '/dashboard/security', icon: Lock, label: 'Security' },
    ],
  },
  {
    label: 'Activity',
    links: [
      { to: '/dashboard/history', icon: History, label: 'History' },
      { to: '/dashboard/notifications', icon: Bell, label: 'Notifications' },
      { to: '/dashboard/chat', icon: MessageSquare, label: 'Chat' },
    ],
  },
];

const adminGroups = [
  {
    label: 'Overview',
    links: [{ to: '/admin', icon: LayoutDashboard, label: 'Dashboard', end: true }],
  },
  {
    label: 'Management',
    links: [
      { to: '/admin/users', icon: Users, label: 'Users' },
      { to: '/admin/inactive-users', icon: UserX, label: 'Inactive Users' },
      { to: '/admin/plan-changes', icon: ClipboardList, label: 'Plan Changes' },
    ],
  },
  {
    label: 'Payments',
    links: [
      { to: '/admin/payments', icon: CreditCard, label: 'Payments' },
      { to: '/admin/topups', icon: ArrowUpDown, label: 'Top-Ups' },
      { to: '/admin/payment-settings', icon: Settings, label: 'Payment Settings' },
    ],
  },
  {
    label: 'Insights',
    links: [
      { to: '/admin/financial-reports', icon: BarChart3, label: 'Financial Reports' },
      { to: '/admin/suspicious-activity', icon: AlertTriangle, label: 'Suspicious Activity' },
    ],
  },
  {
    label: 'System',
    links: [
      { to: '/admin/chat', icon: MessageSquare, label: 'Chat' },
      { to: '/admin/audit-logs', icon: ScrollText, label: 'Audit Logs' },
    ],
  },
];

// Kept exported for any consumers that relied on flat link lists.
export const userLinks = userGroups.flatMap((g) => g.links);
export const adminLinks = adminGroups.flatMap((g) => g.links);

export default function Sidebar({ isOpen, onClose, isAdmin, currentPath }) {
  const navigate = useNavigate();
  const groups = isAdmin ? adminGroups : userGroups;

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    onClose();
    navigate(isAdmin ? '/admin/login' : '/login');
  };

  const isActive = (link) => {
    if (link.end) return currentPath === link.to;
    return currentPath.startsWith(link.to);
  };

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`navy-sidebar fixed top-0 left-0 z-50 h-full w-64 border-r border-line flex flex-col
          transform transition-transform duration-200 ease-out lg:translate-x-0 lg:static lg:z-auto ${
            isOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        aria-label={isAdmin ? 'Admin navigation' : 'Account navigation'}
      >
        {/* Brand */}
        <div className="flex items-center justify-between px-5 h-16 border-b border-line shrink-0">
          <NavLink to={isAdmin ? '/admin' : '/dashboard'} className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center shrink-0">
              <Shield size={16} className="text-white" aria-hidden="true" />
            </div>
            <div className="leading-tight min-w-0">
              <span className="block font-bold tracking-tight text-ink text-sm">
                JSREE{isAdmin && <span className="text-primary-600 dark:text-primary-400"> Admin</span>}
              </span>
              <span className="block text-[11px] text-ink-faint mt-px truncate">
                {isAdmin ? 'Administration' : 'Membership Portal'}
              </span>
            </div>
          </NavLink>
          <button
            onClick={onClose}
            className="btn btn-ghost btn-icon btn-sm lg:hidden"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 pb-3 overflow-y-auto">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="nav-group-label">{group.label}</p>
              <ul className="space-y-0.5">
                {group.links.map((link) => {
                  const active = isActive(link);
                  return (
                    <li key={link.to}>
                      <NavLink
                        to={link.to}
                        end={link.end}
                        onClick={onClose}
                        aria-current={active ? 'page' : undefined}
                        className={`nav-item ${active ? 'nav-item-active' : ''}`}
                      >
                        <link.icon size={17} className="nav-icon shrink-0 text-ink-faint" />
                        <span className="truncate">{link.label}</span>
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Logout */}
        <div className="p-3 border-t border-line shrink-0">
          <button
            onClick={handleLogout}
            className="nav-item w-full text-ink-muted hover:bg-error-500/10 hover:text-error-600 dark:hover:text-error-400"
          >
            <LogOut size={17} />
            <span>Log out</span>
          </button>
        </div>
      </aside>
    </>
  );
}
