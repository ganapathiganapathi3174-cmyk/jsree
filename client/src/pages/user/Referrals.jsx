import { useState, useEffect } from 'react';
import { Users, Copy } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import StatusBadge from '../../components/StatusBadge';
import EmptyState from '../../components/EmptyState';
import LoadingSpinner from '../../components/LoadingSpinner';
import ShareMenu from '../../components/ShareMenu';
import PageHeader from '../../components/PageHeader';

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
      <PageHeader title="My Referrals" description="Share your code and earn rewards" />

      <div className="card">
        <h3 className="text-base font-semibold text-ink mb-3">Your Referral Code</h3>
        <div className={`flex items-center gap-3 rounded-lg border border-line bg-surface-2 p-4${canReferMore ? '' : ' opacity-60'}`}>
          <span className="font-mono text-xl font-bold text-ink flex-1 break-all">{code}</span>
          <button onClick={copyCode} className="btn btn-primary shrink-0"><Copy className="h-4 w-4" aria-hidden="true" /> Copy</button>
        </div>
        <div className="mt-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <input className="input-field flex-1" readOnly value={link} aria-label="Referral link" />
          <ShareMenu link={link} text={`Join me on JSREE with my referral code ${code}: ${link}`} />
        </div>
      </div>

      {canReferMore ? (
        <div className="callout callout-success">
          You can refer up to 2 active members. Slots left: {2 - active}.
        </div>
      ) : (
        <div className="callout callout-warning">
          Referral limit reached (2 active members). You can no longer earn from new referrals.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="stat-card text-center"><p className="text-2xl sm:text-3xl font-bold text-ink">{referrals.length}</p><p className="text-sm text-ink-muted">Total</p></div>
        <div className="stat-card text-center"><p className="text-2xl sm:text-3xl font-bold text-success-600 dark:text-success-400">{active}</p><p className="text-sm text-ink-muted">Active</p></div>
        <div className="stat-card text-center"><p className="text-2xl sm:text-3xl font-bold text-ink-faint">{inactive}</p><p className="text-sm text-ink-muted">Inactive</p></div>
      </div>

      {referrals.length === 0 ? (
        <div className="table-shell">
          <EmptyState icon={<Users className="h-6 w-6" />} title="No referrals yet" description="Share your code with friends to earn rewards." />
        </div>
      ) : (
        <div className="space-y-3">
          {referrals.map(r => (
            <div key={r.id} className="card flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-ink truncate">{r.full_name || r.referred_name || r.id?.slice(0, 8)}</p>
                <p className="text-sm text-ink-muted truncate">{r.email || ''}</p>
              </div>
              <StatusBadge status={r.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
