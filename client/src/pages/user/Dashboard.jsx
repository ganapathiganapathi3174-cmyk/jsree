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
import PageHeader from '../../components/PageHeader';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  useEffect(() => {
    api.get('/users/dashboard').then(r => setData(r.data.data)).catch(() => toast.error('Failed to load dashboard')).finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner fullPage />;
  if (!data) return <div className="callout callout-error" role="alert">Failed to load dashboard</div>;

  const { profile, topupSummary, referralSummary } = data;
  const referralLink = `${window.location.origin}/register?ref=${profile?.referral_code || ''}`;

  const copyCode = () => { navigator.clipboard.writeText(profile?.referral_code || ''); toast.success('Code copied!'); };

  const firstName = profile?.full_name?.split(' ')[0] || 'there';

  const stats = [
    { label: 'Total Received', value: topupSummary?.totalReceived || 0, icon: Wallet, tile: 'bg-info-500/10 text-info-600 dark:text-info-400' },
    { label: 'Pending', value: topupSummary?.pending || 0, icon: Clock, tile: 'bg-warning-500/10 text-warning-600 dark:text-warning-400' },
    { label: 'Completed', value: topupSummary?.completed || 0, icon: CheckCircle2, tile: 'bg-success-500/10 text-success-600 dark:text-success-400' },
    { label: 'Referrals', value: referralSummary?.total || 0, icon: Users, tile: 'bg-primary-500/10 text-primary-600 dark:text-primary-400' },
  ];

  const quickActions = [
    { to: '/dashboard/payment', label: 'Payments', icon: CreditCard },
    { to: '/dashboard/topups', label: 'Top Ups', icon: ArrowDownUp },
    { to: '/dashboard/referrals', label: 'Referrals', icon: Users },
    { to: '/dashboard/chat', label: 'Chat', icon: MessageSquare },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-4">
            <Avatar user={profile} size={48} />
            <span className="min-w-0 truncate">Welcome back, {firstName}</span>
          </span>
        }
        description="Here's your account overview."
        actions={<Link to="/dashboard/profile" className="btn btn-secondary">View Profile</Link>}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map((s, i) => (
          <div key={i} className="stat-card">
            <div className="flex items-center gap-3 h-full">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${s.tile}`}><s.icon className="h-5 w-5" aria-hidden="true" /></div>
              <div className="min-w-0">
                <p className="text-2xl sm:text-3xl font-bold text-ink leading-tight">₹{s.value.toLocaleString()}</p>
                <p className="text-sm text-ink-muted truncate">{s.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="card">
          <div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 bg-primary-500/10 text-primary-600 dark:text-primary-400 rounded-xl flex items-center justify-center"><User className="h-5 w-5" aria-hidden="true" /></div><h3 className="text-base font-semibold text-ink">Profile</h3></div>
          <div className="space-y-2.5 text-sm">
            <p className="flex items-center gap-2 text-ink-muted"><User className="h-4 w-4 text-ink-faint shrink-0" aria-hidden="true" /> {profile?.full_name}</p>
            <p className="flex items-center gap-2 text-ink-muted min-w-0"><Mail className="h-4 w-4 text-ink-faint shrink-0" aria-hidden="true" /> <span className="truncate">{profile?.email}</span></p>
            <p className="flex items-center gap-2 text-ink-muted"><Phone className="h-4 w-4 text-ink-faint shrink-0" aria-hidden="true" /> {profile?.mobile}</p>
            <p className="flex items-center gap-2 text-ink-muted"><Hash className="h-4 w-4 text-ink-faint shrink-0" aria-hidden="true" /> {profile?.id?.slice(0, 8)}</p>
            <div className="flex items-center gap-2"><span className="text-ink-faint">Plan:</span> <span className="font-semibold text-ink">{PLAN_MAP[profile?.current_plan]?.label || 'Not set'}</span></div>
            <div className="flex items-center gap-2"><span className="text-ink-faint">Status:</span> <StatusBadge status={profile?.status} /></div>
            <p className="text-ink-faint text-xs">Joined: {new Date(profile?.created_at).toLocaleDateString()}</p>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center gap-3 mb-5"><div className="w-10 h-10 bg-success-500/10 text-success-600 dark:text-success-400 rounded-xl flex items-center justify-center"><ArrowUpRight className="h-5 w-5" aria-hidden="true" /></div><h3 className="text-base font-semibold text-ink">Top-Up Summary</h3></div>
          <div className="space-y-3">
            <div className="flex justify-between border-b border-line/70 pb-2.5"><span className="text-ink-muted text-sm">Total Received</span><span className="font-semibold text-ink">₹{topupSummary?.totalReceived || 0}</span></div>
            <div className="flex justify-between border-b border-line/70 pb-2.5"><span className="text-ink-muted text-sm">Pending</span><span className="font-semibold text-warning-600 dark:text-warning-400">₹{topupSummary?.pending || 0}</span></div>
            <div className="flex justify-between"><span className="text-ink-muted text-sm">Completed</span><span className="font-semibold text-success-600 dark:text-success-400">₹{topupSummary?.completed || 0}</span></div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center gap-3 mb-5"><div className="w-10 h-10 bg-primary-500/10 text-primary-600 dark:text-primary-400 rounded-xl flex items-center justify-center"><Users className="h-5 w-5" aria-hidden="true" /></div><h3 className="text-base font-semibold text-ink">Referrals</h3></div>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-ink-faint mb-1">Your Code</p>
              <div className="flex items-center gap-2 bg-surface-2 border border-line rounded-lg p-2.5">
                <span className="font-mono text-sm font-bold flex-1 text-ink break-all">{profile?.referral_code}</span>
                <button onClick={copyCode} className="btn btn-ghost btn-icon btn-sm shrink-0" aria-label="Copy referral code"><Copy className="h-4 w-4" aria-hidden="true" /></button>
              </div>
            </div>
            <div>
              <p className="text-xs text-ink-faint mb-1">Referral Link</p>
              <ShareMenu
                link={referralLink}
                text={`Join me on JSREE with my referral code ${profile?.referral_code || ''}: ${referralLink}`}
                variant="secondary"
              />
            </div>
            <div className="flex justify-between border-t border-line/70 pt-3 text-sm"><span className="text-ink-muted">Total</span><span className="font-semibold text-ink">{referralSummary?.total || 0}</span></div>
            <div className="flex justify-between text-sm"><span className="text-ink-muted">Active</span><span className="font-semibold text-success-600 dark:text-success-400">{referralSummary?.active || 0}</span></div>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="text-base font-semibold text-ink mb-4">Quick Actions</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {quickActions.map((a, i) => (
            <Link key={i} to={a.to} className="btn btn-secondary w-full">
              <a.icon className="h-4 w-4" aria-hidden="true" /> {a.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
