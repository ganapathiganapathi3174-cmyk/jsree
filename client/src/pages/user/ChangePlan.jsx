import { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import { PLANS, PLAN_MAP } from '../../utils/constants';
import StatusBadge from '../../components/StatusBadge';
import LoadingSpinner from '../../components/LoadingSpinner';
import PageHeader from '../../components/PageHeader';

export default function ChangePlan() {
  const [currentPlan, setCurrentPlan] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [reason, setReason] = useState('');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/users/profile').then(r => setCurrentPlan(r.data.data?.current_plan)),
      api.get('/plans/my-requests').then(r => setRequests(r.data.data || []))
    ]).catch(() => toast.error('Failed to load')).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const hasPending = requests.some(r => r.status === 'pending');

  const handleSubmit = async () => {
    if (hasPending) { toast.error('You already have a pending plan change request'); return; }
    if (!selectedPlan) { toast.error('Select a plan'); return; }
    if (selectedPlan === currentPlan) { toast.error('Select a different plan'); return; }
    setSubmitting(true);
    try {
      await api.post('/plans/change-request', { requestedPlan: String(selectedPlan), reason });
      toast.success('Request submitted!');
      setSelectedPlan(null); setReason('');
      load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setSubmitting(false); }
  };

  if (loading) return <LoadingSpinner fullPage />;

  return (
    <div className="space-y-6">
      <PageHeader title="Change Plan" description="Request a move to a different membership plan" />

      <div className="card">
        {hasPending && (
          <div className="callout callout-warning mb-4">
            <span>You already have a pending plan change request{requests.find(r => r.status === 'pending')?.requested_plan ? ` (Requested: ${PLAN_MAP[requests.find(r => r.status === 'pending').requested_plan]?.label || ''})` : ''}. Please wait for admin review.</span>
          </div>
        )}
        <p className="text-sm text-ink-muted mb-5">Current Plan: <strong className="text-ink">{PLAN_MAP[currentPlan]?.label || 'None'}</strong></p>
        <h3 className="text-base font-semibold text-ink mb-3">Select New Plan</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4" role="group" aria-label="Plans">
          {PLANS.map(p => (
            <button
              key={p.id}
              onClick={() => setSelectedPlan(p.id)}
              disabled={p.id === currentPlan}
              aria-pressed={selectedPlan === p.id}
              className={`w-full px-4 py-3.5 rounded-lg border text-center transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/50 ${
                p.id === currentPlan
                  ? 'border-line bg-surface-2 opacity-60 cursor-not-allowed'
                  : selectedPlan === p.id
                    ? 'border-primary-600 bg-primary-500/10'
                    : 'border-line bg-surface hover:bg-surface-2'
              }`}
            >
              <span className={`font-bold text-lg ${p.id === currentPlan ? 'text-ink-faint' : selectedPlan === p.id ? 'text-primary-700 dark:text-primary-300' : 'text-ink'}`}>{p.label}</span>
              <p className="text-xs text-ink-muted mt-1">{p.name}</p>
            </button>
          ))}
        </div>
        <div className="mb-4">
          <label htmlFor="change-plan-reason" className="label">Reason for change (optional)</label>
          <textarea id="change-plan-reason" className="input-field" rows={3} placeholder="Reason for change (optional)" value={reason} onChange={e => setReason(e.target.value)} disabled={hasPending} />
        </div>
        <button onClick={handleSubmit} disabled={submitting || !selectedPlan || hasPending} className="btn btn-primary">
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> {hasPending ? 'Pending Request' : submitting ? 'Submitting...' : 'Submit Request'}
        </button>
      </div>

      {requests.length > 0 && (
        <div className="card">
          <h3 className="text-base font-semibold text-ink mb-3">Request History</h3>
          <div className="space-y-1">
            {requests.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-3 py-2.5 border-b border-line/70 last:border-0">
                <div className="min-w-0">
                  <p className="text-sm text-ink">{PLAN_MAP[r.current_plan]?.label} <span className="text-ink-faint" aria-hidden="true">→</span> {PLAN_MAP[r.requested_plan]?.label}</p>
                  <p className="text-xs text-ink-faint">{new Date(r.created_at).toLocaleDateString()}</p>
                </div>
                <StatusBadge status={r.status} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
