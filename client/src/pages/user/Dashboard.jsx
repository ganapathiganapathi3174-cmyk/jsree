import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { User, Mail, Phone, Hash, CreditCard, Users, ArrowUpRight, MessageSquare, Copy } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import { PLAN_MAP } from '../../utils/constants';
import StatusBadge from '../../components/StatusBadge';
import LoadingSpinner from '../../components/LoadingSpinner';
import Avatar from '../../components/Avatar';

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
  const copyLink = () => { navigator.clipboard.writeText(referralLink); toast.success('Link copied!'); };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Avatar user={profile} size={56} className="ring-4 ring-white/20 shadow-xl" />
        <div>
          <h1 className="text-2xl font-bold text-white">Welcome back, {profile?.full_name?.split(' ')[0] || 'there'}</h1>
          <p className="text-indigo-100/70 text-sm">JSREE Dashboard</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="card">
          <div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center"><User className="h-5 w-5 text-primary-600" /></div><h3 className="font-semibold text-gray-900">Profile</h3></div>
          <div className="space-y-2 text-sm">
            <p className="flex items-center gap-2"><User className="h-4 w-4 text-gray-400" /> {profile?.full_name}</p>
            <p className="flex items-center gap-2"><Mail className="h-4 w-4 text-gray-400" /> {profile?.email}</p>
            <p className="flex items-center gap-2"><Phone className="h-4 w-4 text-gray-400" /> {profile?.mobile}</p>
            <p className="flex items-center gap-2"><Hash className="h-4 w-4 text-gray-400" /> {profile?.id?.slice(0, 8)}</p>
            <p className="flex items-center gap-2"><CreditCard className="h-4 w-4 text-gray-400" /> {PLAN_MAP[profile?.current_plan]?.label || 'Not set'}</p>
            <div className="flex items-center gap-2"><span className="text-gray-400">Status:</span> <StatusBadge status={profile?.status} /></div>
            <p className="text-gray-500 text-xs">Joined: {new Date(profile?.created_at).toLocaleDateString()}</p>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center"><ArrowUpRight className="h-5 w-5 text-green-600" /></div><h3 className="font-semibold text-gray-900">Top-Up Summary</h3></div>
          <div className="space-y-3">
            <div className="flex justify-between"><span className="text-gray-600 text-sm">Total Received</span><span className="font-semibold">₹{topupSummary?.totalReceived || 0}</span></div>
            <div className="flex justify-between"><span className="text-gray-600 text-sm">Pending</span><span className="font-semibold text-yellow-600">₹{topupSummary?.pending || 0}</span></div>
            <div className="flex justify-between"><span className="text-gray-600 text-sm">Completed</span><span className="font-semibold text-green-600">₹{topupSummary?.completed || 0}</span></div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center"><Users className="h-5 w-5 text-purple-600" /></div><h3 className="font-semibold text-gray-900">Referrals</h3></div>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-gray-500 mb-1">Your Code</p>
              <div className="flex items-center gap-2 bg-gray-50 rounded-lg p-2">
                <span className="font-mono text-sm font-bold flex-1">{profile?.referral_code}</span>
                <button onClick={copyCode}><Copy className="h-4 w-4 text-primary-600" /></button>
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Referral Link</p>
              <button onClick={copyLink} className="text-xs text-primary-600 hover:underline flex items-center gap-1 truncate w-full"><Copy className="h-3 w-3" /> Copy Link</button>
            </div>
            <div className="flex justify-between text-sm"><span className="text-gray-600">Total</span><span className="font-semibold">{referralSummary?.total || 0}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-600">Active</span><span className="font-semibold text-green-600">{referralSummary?.active || 0}</span></div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link to="/dashboard/payment" className="btn-primary flex items-center gap-2"><CreditCard className="h-4 w-4" /> Payments</Link>
        <Link to="/dashboard/referrals" className="btn-secondary flex items-center gap-2"><Users className="h-4 w-4" /> Referrals</Link>
        <Link to="/dashboard/chat" className="btn-secondary flex items-center gap-2"><MessageSquare className="h-4 w-4" /> Chat</Link>
      </div>
    </div>
  );
}
