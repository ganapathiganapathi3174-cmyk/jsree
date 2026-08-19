import { useState, useEffect } from 'react';
import { Users, UserCheck, UserX, CreditCard, Clock, CheckCircle, XCircle, IndianRupee, MessageSquare, ArrowDownUp, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import LoadingSpinner from '../../components/LoadingSpinner';

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/admin/dashboard').then(r => setStats(r.data.data)).catch(() => toast.error('Failed to load stats')).finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner fullPage />;
  if (!stats) return <div className="text-center text-gray-500 p-8">Failed to load dashboard</div>;

  const cards = [
    { label: 'Total Users', value: stats.totalUsers || 0, icon: Users, tile: 'bg-info-50 text-info-600' },
    { label: 'Active Users', value: stats.activeUsers || 0, icon: UserCheck, tile: 'bg-success-50 text-success-600' },
    { label: 'Inactive Users', value: stats.inactiveUsers || 0, icon: UserX, tile: 'bg-gray-100 text-gray-500' },
    { label: 'Pending Payments', value: stats.pendingPayments || 0, icon: Clock, tile: 'bg-warning-50 text-warning-600' },
    { label: 'Approved Payments', value: stats.approvedPayments || 0, icon: CheckCircle, tile: 'bg-success-50 text-success-600' },
    { label: 'Rejected Payments', value: stats.rejectedPayments || 0, icon: XCircle, tile: 'bg-error-50 text-error-600' },
    { label: 'Plan Change Requests', value: stats.pendingPlanChanges || 0, icon: RefreshCw, tile: 'bg-primary-50 text-primary-600' },
    { label: 'Unread Chats', value: stats.unreadChats || 0, icon: MessageSquare, tile: 'bg-warning-50 text-warning-600' },
  ];

  const financial = [
    { label: 'Registration Collection', value: stats.registrationCollection || 0, icon: CreditCard, tile: 'bg-info-50 text-info-600' },
    { label: 'Top-Up Collection', value: stats.topupCollection || 0, icon: ArrowDownUp, tile: 'bg-primary-50 text-primary-600' },
    { label: 'Total Collection', value: (stats.registrationCollection || 0) + (stats.topupCollection || 0), icon: IndianRupee, tile: 'bg-success-50 text-success-600' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Platform overview and financial summary</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map((c, i) => (
          <div key={i} className="stat-card">
            <div className="flex items-center gap-3">
              <div className={`w-11 h-11 rounded-lg flex items-center justify-center ${c.tile}`}><c.icon className="h-5 w-5" /></div>
              <div className="min-w-0">
                <p className="text-2xl font-bold text-gray-900 leading-tight">{c.value.toLocaleString()}</p>
                <p className="text-sm text-gray-500 truncate">{c.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">Financial Summary</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {financial.map((f, i) => (
            <div key={i} className="stat-card flex items-center gap-4">
              <div className={`w-11 h-11 rounded-lg flex items-center justify-center shrink-0 ${f.tile}`}><f.icon className="h-5 w-5" /></div>
              <div className="min-w-0">
                <p className="text-sm text-gray-500 mb-0.5">{f.label}</p>
                <p className="text-2xl font-bold text-gray-900 flex items-center leading-tight">₹{f.value.toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}