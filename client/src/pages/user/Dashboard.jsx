import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { User, Mail, Phone, Hash, CreditCard, Users, ArrowUpRight, MessageSquare, Copy, Clock, CheckCircle2, Wallet, ArrowDownUp } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import { PLAN_MAP } from '../../utils/constants';
import StatusBadge from '../../components/StatusBadge';
import LoadingSpinner from '../../components/LoadingSpinner';
import Avatar from '../../components/Avatar';
import ShareMenu from '../../components/ShareMenu';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  useEffect(() => {
    api.get('/users/dashboard').then(r => setData(r.data.data)).catch(() => toast.error('Failed to load dashboard')).finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner fullPage />;
  if (!data) return <div className="p-6 text-center text-gray-500">Failed to load dashboard</div>;

  const { profile, topupSummary, referralSummary } = data;
  const referralLink = `${window.location.origin}/register?ref=${profile?.referral_code || ''}`;

  const copyCode = () => { navigator.clipboard.writeText(profile?.referral_code || ''); toast.success('Code copied!'); };

  const firstName = profile?.full_name?.split(' ')[0] || 'there';

  const stats = [
    { label: 'Total Received', value: topupSummary?.totalReceived || 0, icon: Wallet, tile: 'bg-info-50 text-info-500' },
    { label: 'Pending', value: topupSummary?.pending || 0, icon: Clock, tile: 'bg-warning-50 text-warning-500' },
    { label: 'Completed', value: topupSummary?.completed || 0, icon: CheckCircle2, tile: 'bg-success-50 text-success-500' },
    { label: 'Referrals', value: referralSummary?.total || 0, icon: Users, tile: 'bg-primary-50 text-primary-500' },
  ];

  const quickActions = [
    { to: '/dashboard/payment', label: 'Payments', icon: CreditCard },
    { to: '/dashboard/topups', label: 'Top Ups', icon: ArrowDownUp },
    { to: '/dashboard/referrals', label: 'Referrals', icon: Users },
    { to: '/dashboard/chat', label: 'Chat', icon: MessageSquare },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar user={profile} size={56} />
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Welcome back, {firstName}</h1>
            <p className="text-gray-500 text-sm mt-1">Here's your account overview.</p>
          </div>
        </div>
        <Link to="/dashboard/profile" className="btn-secondary">View Profile</Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map((s, i) => (
          <div key={i} className="stat-card">
            <div className="flex items-center gap-3 h-full">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${s.tile}`}><s.icon className="h-5 w-5" /></div>
              <div className="min-w-0">
                <p className="text-2xl sm:text-3xl font-bold text-gray-900 leading-tight">₹{s.value.toLocaleString()}</p>
                <p className="text-sm text-gray-500 truncate">{s.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="card">
          <div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 bg-primary-50 text-primary-500 rounded-xl flex items-center justify-center"><User className="h-5 w-5" /></div><h3 className="font-semibold text-gray-900">Profile</h3></div>
          <div className="space-y-2 text-sm">
            <p className="flex items-center gap-2 text-gray-700"><User className="h-4 w-4 text-gray-400" /> {profile?.full_name}</p>
            <p className="flex items-center gap-2 text-gray-700"><Mail className="h-4 w-4 text-gray-400" /> {profile?.email}</p>
            <p className="flex items-center gap-2 text-gray-700"><Phone className="h-4 w-4 text-gray-400" /> {profile?.mobile}</p>
            <p className="flex items-center gap-2 text-gray-700"><Hash className="h-4 w-4 text-gray-400" /> {profile?.id?.slice(0, 8)}</p>
            <div className="flex items-center gap-2"><span className="text-gray-400">Plan:</span> <span className="font-semibold text-gray-900">{PLAN_MAP[profile?.current_plan]?.label || 'Not set'}</span></div>
            <div className="flex items-center gap-2"><span className="text-gray-400">Status:</span> <StatusBadge status={profile?.status} /></div>
            <p className="text-gray-500 text-xs">Joined: {new Date(profile?.created_at).toLocaleDateString()}</p>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center gap-3 mb-5"><div className="w-10 h-10 bg-success-50 text-success-500 rounded-xl flex items-center justify-center"><ArrowUpRight className="h-5 w-5" /></div><h3 className="font-semibold text-gray-900">Top-Up Summary</h3></div>
          <div className="space-y-3">
            <div className="flex justify-between border-b border-gray-100 pb-2"><span className="text-gray-500 text-sm">Total Received</span><span className="font-semibold text-gray-900">₹{topupSummary?.totalReceived || 0}</span></div>
            <div className="flex justify-between border-b border-gray-100 pb-2"><span className="text-gray-500 text-sm">Pending</span><span className="font-semibold text-warning-500">₹{topupSummary?.pending || 0}</span></div>
            <div className="flex justify-between"><span className="text-gray-500 text-sm">Completed</span><span className="font-semibold text-success-500">₹{topupSummary?.completed || 0}</span></div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center gap-3 mb-5"><div className="w-10 h-10 bg-primary-50 text-primary-500 rounded-xl flex items-center justify-center"><Users className="h-5 w-5" /></div><h3 className="font-semibold text-gray-900">Referrals</h3></div>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-gray-500 mb-1">Your Code</p>
              <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl p-2.5">
                <span className="font-mono text-sm font-bold flex-1 text-gray-900">{profile?.referral_code}</span>
                <button onClick={copyCode} className="text-primary-500 hover:text-primary-400" aria-label="Copy referral code"><Copy className="h-4 w-4" /></button>
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Referral Link</p>
              <ShareMenu
                link={referralLink}
                text={`Join me on JSREE with my referral code ${profile?.referral_code || ''}: ${referralLink}`}
                variant="secondary"
              />
            </div>
            <div className="flex justify-between border-t border-gray-100 pt-3 text-sm"><span className="text-gray-500">Total</span><span className="font-semibold text-gray-900">{referralSummary?.total || 0}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-500">Active</span><span className="font-semibold text-success-500">{referralSummary?.active || 0}</span></div>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="font-semibold text-gray-900 mb-4">Quick Actions</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {quickActions.map((a, i) => (
            <Link key={i} to={a.to} className="btn-secondary w-full">
              <a.icon className="h-4 w-4" /> {a.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
