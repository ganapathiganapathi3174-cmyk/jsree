import { useState, useEffect } from 'react';
import { Users, Copy, Share2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import StatusBadge from '../../components/StatusBadge';
import EmptyState from '../../components/EmptyState';
import LoadingSpinner from '../../components/LoadingSpinner';

export default function Referrals() {
  const [code, setCode] = useState('');
  const [referrals, setReferrals] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/referrals/my-code').then(r => setCode(r.data.data?.referralCode || r.data.data?.referral_code || '')),
      api.get('/referrals/my-referrals').then(r => setReferrals(r.data.data?.referrals || r.data.data || []))
    ]).catch(() => toast.error('Failed to load referral data')).finally(() => setLoading(false));
  }, []);

  const link = `${window.location.origin}/register?ref=${code}`;
  const copyCode = () => { navigator.clipboard.writeText(code); toast.success('Code copied!'); };
  const copyLink = () => { navigator.clipboard.writeText(link); toast.success('Link copied!'); };

  if (loading) return <LoadingSpinner fullPage />;

  const active = referrals.filter(r => r.status === 'active').length;
  const inactive = referrals.filter(r => r.status !== 'active').length;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">My Referrals</h1>

      <div className="card">
        <h3 className="font-semibold mb-3">Your Referral Code</h3>
        <div className="flex items-center gap-3 bg-gray-50 rounded-xl p-4">
          <span className="font-mono text-xl font-bold flex-1">{code}</span>
          <button onClick={copyCode} className="btn-primary flex items-center gap-1"><Copy className="h-4 w-4" /> Copy</button>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input className="input-field flex-1 text-sm" readOnly value={link} />
          <button onClick={copyLink} className="btn-secondary flex items-center gap-1"><Share2 className="h-4 w-4" /> Share</button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="stat-card text-center"><p className="text-2xl font-bold text-gray-900">{referrals.length}</p><p className="text-sm text-gray-500">Total</p></div>
        <div className="stat-card text-center"><p className="text-2xl font-bold text-green-600">{active}</p><p className="text-sm text-gray-500">Active</p></div>
        <div className="stat-card text-center"><p className="text-2xl font-bold text-gray-400">{inactive}</p><p className="text-sm text-gray-500">Inactive</p></div>
      </div>

      {referrals.length === 0 ? (
        <EmptyState icon={<Users className="h-12 w-12" />} title="No referrals yet" description="Share your code with friends to earn rewards." />
      ) : (
        <div className="space-y-3">
          {referrals.map(r => (
            <div key={r.id} className="card flex items-center justify-between">
              <div><p className="font-medium">{r.full_name || r.referred_name || r.id?.slice(0, 8)}</p><p className="text-sm text-gray-500">{r.email || ''}</p></div>
              <StatusBadge status={r.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
