import { useState, useEffect } from 'react';
import { Users, Copy } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import StatusBadge from '../../components/StatusBadge';
import EmptyState from '../../components/EmptyState';
import LoadingSpinner from '../../components/LoadingSpinner';
import ShareMenu from '../../components/ShareMenu';

export default function Referrals() {
  const [code, setCode] = useState('');
  const [referrals, setReferrals] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/referrals/my-code').then(r => setCode(r.data.data?.referralCode || r.data.data?.referral_code || '')),
      api.get('/referrals/my-referrals').then(r => {
        setReferrals(r.data.data?.referrals || r.data.data || []);
        setStats(r.data.data?.stats || null);
      })
    ]).catch(() => toast.error('Failed to load referral data')).finally(() => setLoading(false));
  }, []);

  const link = `${window.location.origin}/register?ref=${code}`;
  const copyCode = () => { navigator.clipboard.writeText(code); toast.success('Code copied!'); };

  if (loading) return <LoadingSpinner fullPage />;

  const active = referrals.filter(r => r.status === 'active').length;
  const inactive = referrals.filter(r => r.status !== 'active').length;
  const canReferMore = stats?.canReferMore ?? active < 2;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">My Referrals</h1>
        <p className="text-sm text-gray-500 mt-1">Share your code and earn rewards</p>
      </div>

      <div className="card">
        <h3 className="font-semibold text-gray-900 mb-3">Your Referral Code</h3>
        <div className={`flex items-center gap-3 rounded-xl p-4 ${canReferMore ? 'bg-gray-50 border border-gray-200' : 'bg-gray-100 border border-gray-200 opacity-70'}`}>
          <span className="font-mono text-xl font-bold text-gray-900 flex-1">{code}</span>
          <button onClick={copyCode} className="btn-primary"><Copy className="h-4 w-4" /> Copy</button>
        </div>
        <div className="mt-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <input className="input-field flex-1 text-sm" readOnly value={link} />
          <ShareMenu link={link} text={`Join me on JSREE with my referral code ${code}: ${link}`} />
        </div>
      </div>

      <div className={`rounded-xl p-4 text-sm ${canReferMore ? 'bg-success-50 border border-success-200 text-success-700' : 'bg-warning-50 border border-warning-200 text-warning-700'}`}>
        {canReferMore
          ? `You can refer up to 2 active members. Slots left: ${2 - active}.`
          : 'Referral limit reached (2 active members). You can no longer earn from new referrals.'}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="stat-card text-center"><p className="text-2xl sm:text-3xl font-bold text-gray-900">{referrals.length}</p><p className="text-sm text-gray-500">Total</p></div>
        <div className="stat-card text-center"><p className="text-2xl sm:text-3xl font-bold text-success-500">{active}</p><p className="text-sm text-gray-500">Active</p></div>
        <div className="stat-card text-center"><p className="text-2xl sm:text-3xl font-bold text-gray-400">{inactive}</p><p className="text-sm text-gray-500">Inactive</p></div>
      </div>

      {referrals.length === 0 ? (
        <div className="table-shell">
          <EmptyState icon={<Users className="h-12 w-12" />} title="No referrals yet" description="Share your code with friends to earn rewards." />
        </div>
      ) : (
        <div className="space-y-3">
          {referrals.map(r => (
            <div key={r.id} className="card flex items-center justify-between">
              <div><p className="font-medium text-gray-900">{r.full_name || r.referred_name || r.id?.slice(0, 8)}</p><p className="text-sm text-gray-500">{r.email || ''}</p></div>
              <StatusBadge status={r.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}