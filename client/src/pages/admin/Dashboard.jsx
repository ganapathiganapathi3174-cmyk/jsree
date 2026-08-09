import { useState, useEffect } from 'react';
import { Users, UserCheck, UserX, CreditCard, Clock, CheckCircle, XCircle, IndianRupee, MessageSquare, ArrowUpDown, RefreshCw } from 'lucide-react';
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
    { label: 'Total Users', value: stats.totalUsers || 0, icon: Users, color: 'bg-blue-100 text-blue-600' },
    { label: 'Active Users', value: stats.activeUsers || 0, icon: UserCheck, color: 'bg-green-100 text-green-600' },
    { label: 'Inactive Users', value: stats.inactiveUsers || 0, icon: UserX, color: 'bg-gray-100 text-gray-600' },
    { label: 'Pending Payments', value: stats.pendingPayments || 0, icon: Clock, color: 'bg-yellow-100 text-yellow-600' },
    { label: 'Approved Payments', value: stats.approvedPayments || 0, icon: CheckCircle, color: 'bg-green-100 text-green-600' },
    { label: 'Rejected Payments', value: stats.rejectedPayments || 0, icon: XCircle, color: 'bg-red-100 text-red-600' },
    { label: 'Plan Change Requests', value: stats.pendingPlanChanges || 0, icon: RefreshCw, color: 'bg-purple-100 text-purple-600' },
    { label: 'Unread Chats', value: stats.unreadChats || 0, icon: MessageSquare, color: 'bg-orange-100 text-orange-600' },
  ];

  const financial = [
    { label: 'Registration Collection', value: stats.registrationCollection || 0, color: 'bg-green-50 border-green-200' },
    { label: 'Top-Up Collection', value: stats.topupCollection || 0, color: 'bg-blue-50 border-blue-200' },
    { label: 'Total Collection', value: (stats.registrationCollection || 0) + (stats.topupCollection || 0), color: 'bg-primary-50 border-primary-200' },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map((c, i) => (
          <div key={i} className="stat-card">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${c.color}`}><c.icon className="h-5 w-5" /></div>
              <div><p className="text-2xl font-bold text-gray-900">{c.value}</p><p className="text-sm text-gray-500">{c.label}</p></div>
            </div>
          </div>
        ))}
      </div>

      <h2 className="text-lg font-semibold text-gray-900">Financial Summary</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {financial.map((f, i) => (
          <div key={i} className={`rounded-xl border p-5 ${f.color}`}>
            <p className="text-sm text-gray-600 mb-1">{f.label}</p>
            <p className="text-2xl font-bold flex items-center"><IndianRupee className="h-5 w-5" />{f.value.toLocaleString()}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
