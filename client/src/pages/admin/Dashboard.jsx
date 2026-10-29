import { useState, useEffect } from 'react';
import { Users, UserCheck, UserX, CreditCard, Clock, CheckCircle, XCircle, IndianRupee, MessageSquare, ArrowDownUp, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import LoadingSpinner from '../../components/LoadingSpinner';
import PageHeader from '../../components/PageHeader';

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/admin/dashboard').then(r => setStats(r.data.data)).catch(() => toast.error('Failed to load stats')).finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner fullPage />;
  if (!stats) return <div className="callout callout-error max-w-md mx-auto mt-10">Failed to load dashboard</div>;

  const cards = [
    { label: 'Total Users', value: stats.totalUsers || 0, icon: Users, tile: 'bg-info-500/10 text-info-600' },
    { label: 'Active Users', value: stats.activeUsers || 0, icon: UserCheck, tile: 'bg-success-500/10 text-success-600' },
    { label: 'Inactive Users', value: stats.inactiveUsers || 0, icon: UserX, tile: 'bg-surface-2 text-ink-muted' },
    { label: 'Pending Payments', value: stats.pendingPayments || 0, icon: Clock, tile: 'bg-warning-500/10 text-warning-600' },
    { label: 'Approved Payments', value: stats.approvedPayments || 0, icon: CheckCircle, tile: 'bg-success-500/10 text-success-600' },
    { label: 'Rejected Payments', value: stats.rejectedPayments || 0, icon: XCircle, tile: 'bg-error-500/10 text-error-600' },
    { label: 'Plan Change Requests', value: stats.pendingPlanChanges || 0, icon: RefreshCw, tile: 'bg-primary-500/10 text-primary-600' },
    { label: 'Unread Chats', value: stats.unreadChats || 0, icon: MessageSquare, tile: 'bg-warning-500/10 text-warning-600' },
  ];

  const financial = [
    { label: 'Registration Collection', value: stats.registrationCollection || 0, icon: CreditCard, tile: 'bg-info-500/10 text-info-600' },
    { label: 'Top-Up Collection', value: stats.topupCollection || 0, icon: ArrowDownUp, tile: 'bg-primary-500/10 text-primary-600' },
    { label: 'Total Collection', value: (stats.registrationCollection || 0) + (stats.topupCollection || 0), icon: IndianRupee, tile: 'bg-success-500/10 text-success-600' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Admin Dashboard" description="Platform overview and financial summary" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c, i) => (
          <div key={i} className="stat-card">
            <div className="flex items-center gap-3 h-full">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${c.tile}`}><c.icon className="h-5 w-5" aria-hidden="true" /></div>
              <div className="min-w-0">
                <p className="text-2xl sm:text-3xl font-bold text-ink leading-tight">{c.value.toLocaleString()}</p>
                <p className="text-sm text-ink-muted truncate">{c.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">Financial Summary</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {financial.map((f, i) => (
            <div key={i} className="stat-card flex items-center gap-4">
              <div className={`w-11 h-11 rounded-lg flex items-center justify-center shrink-0 ${f.tile}`}><f.icon className="h-5 w-5" aria-hidden="true" /></div>
              <div className="min-w-0">
                <p className="text-sm text-ink-muted mb-0.5">{f.label}</p>
                <p className="text-2xl sm:text-3xl font-bold text-ink flex items-center leading-tight">₹{f.value.toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
