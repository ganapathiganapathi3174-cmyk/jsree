import { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import { PLANS, PLAN_MAP } from '../../utils/constants';
import StatusBadge from '../../components/StatusBadge';
import EmptyState from '../../components/EmptyState';
import LoadingSpinner from '../../components/LoadingSpinner';

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

  const handleSubmit = async () => {
    if (!selectedPlan) { toast.error('Select a plan'); return; }
    if (selectedPlan === currentPlan) { toast.error('Select a different plan'); return; }
    setSubmitting(true);
    try {
      await api.post('/plans/change-request', { current_plan: currentPlan, requested_plan: selectedPlan, reason });
      toast.success('Request submitted!');
      setSelectedPlan(null); setReason('');
      load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setSubmitting(false); }
  };

  if (loading) return <LoadingSpinner fullPage />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Change Plan</h1>

      <div className="card">
        <p className="text-sm text-gray-600 mb-4">Current Plan: <strong>{PLAN_MAP[currentPlan]?.label || 'None'}</strong></p>
        <h3 className="font-semibold mb-3">Select New Plan</h3>
        <div className="grid grid-cols-3 gap-3 mb-4">
          {PLANS.map(p => (
            <button key={p.id} onClick={() => setSelectedPlan(p.id)} disabled={p.id === currentPlan} className={`p-4 rounded-xl border-2 text-center transition-all ${p.id === currentPlan ? 'border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed' : selectedPlan === p.id ? 'border-primary-600 bg-primary-50' : 'border-gray-200 hover:border-gray-300'}`}>
              <span className="font-bold text-lg">{p.label}</span>
              <p className="text-xs text-gray-500 mt-1">{p.name}</p>
            </button>
          ))}
        </div>
        <textarea className="input-field mb-3" rows={3} placeholder="Reason for change (optional)" value={reason} onChange={e => setReason(e.target.value)} />
        <button onClick={handleSubmit} disabled={submitting || !selectedPlan} className="btn-primary flex items-center gap-2">
          <RefreshCw className="h-4 w-4" /> {submitting ? 'Submitting...' : 'Submit Request'}
        </button>
      </div>

      {requests.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-3">Request History</h3>
          <div className="space-y-3">
            {requests.map(r => (
              <div key={r.id} className="flex items-center justify-between py-2 border-b last:border-0">
                <div><p className="text-sm">{PLAN_MAP[r.current_plan]?.label} → {PLAN_MAP[r.requested_plan]?.label}</p><p className="text-xs text-gray-500">{new Date(r.created_at).toLocaleDateString()}</p></div>
                <StatusBadge status={r.status} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
