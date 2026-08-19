import { useState, useEffect } from 'react';
import { ArrowUpDown, Upload, Eye } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import StatusBadge from '../../components/StatusBadge';
import Modal from '../../components/Modal';
import EmptyState from '../../components/EmptyState';
import LoadingSpinner from '../../components/LoadingSpinner';
import QRPaymentSection from '../../components/QRPaymentSection';

const PAY_AMOUNTS = [120, 500, 1000];

export default function TopUps() {
  const [topups, setTopups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('received');
  const [proofModal, setProofModal] = useState(null);
  const [screenshot, setScreenshot] = useState(null);
  const [refId, setRefId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [payAmount, setPayAmount] = useState(120);
  const [payTarget, setPayTarget] = useState(null);
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  useEffect(() => {
    const current = Number(user.current_plan);
    setPayAmount(PAY_AMOUNTS.includes(current) ? current : 120);
  }, []);

  const load = () => api.get('/topups').then(r => setTopups(r.data.data || [])).catch(() => toast.error('Failed to load top-ups')).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const received = topups.filter(t => t.receiver_id === user.id);
  const sent = topups.filter(t => t.sender_id === user.id);
  const list = tab === 'received' ? received : sent;
  const eligibleForProof = topups.filter(t => t.sender_id === user.id && ['created', 'payment_pending'].includes(t.status));

  const handleProof = async () => {
    if (!screenshot) { toast.error('Upload screenshot'); return; }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('screenshot', screenshot);
      fd.append('reference_id', refId);
      await api.post(`/topups/${proofModal.id}/proof`, fd);
      toast.success('Proof submitted!');
      setProofModal(null); setScreenshot(null); setRefId('');
      load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setSubmitting(false); }
  };

  const handleTopupVerify = async (file) => {
    const targets = eligibleForProof;
    if (targets.length === 0) {
      toast.error('No pending top-up found. A pending top-up is required to attach the payment screenshot.');
      return;
    }
    const targetId = payTarget || targets[0].id;
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('screenshot', file);
      await api.post(`/topups/${targetId}/proof`, fd);
      toast.success('Payment proof submitted!');
      load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to submit proof'); }
    finally { setSubmitting(false); }
  };

  const handlePayTargetChange = (value) => {
    const target = eligibleForProof.find(t => t.id === value);
    setPayTarget(value);
    if (target && PAY_AMOUNTS.includes(Number(target.amount))) setPayAmount(Number(target.amount));
  };

  if (loading) return <LoadingSpinner fullPage />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Top-Ups</h1>
        <p className="text-sm text-gray-500 mt-1">Send and receive top-ups between members</p>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900">Top-Up Payment</h3>
          <span className="rounded bg-primary-50 px-2 py-0.5 text-xs font-semibold text-primary-600 border border-primary-100">UPI</span>
        </div>
        <p className="text-sm text-gray-600 mb-4">Select the amount, pay the JSREE UPI, then upload your payment screenshot for verification.</p>
        {eligibleForProof.length > 0 && (
          <div className="mb-4">
            <label className="label">Attach screenshot to Pending Top-Up</label>
            <select
              value={payTarget || eligibleForProof[0]?.id}
              onChange={(e) => handlePayTargetChange(e.target.value)}
              className="input-field"
            >
              {eligibleForProof.map(t => (
                <option key={t.id} value={t.id}>
                  ₹{t.amount} — {t.receiver_name || t.receiver_id?.slice(0, 8)} ({t.status})
                </option>
              ))}
            </select>
          </div>
        )}
        <QRPaymentSection
          amount={payAmount}
          onAmountChange={(amt) => { setPayAmount(amt); if (eligibleForProof.length > 0 && !payTarget) setPayTarget(eligibleForProof[0].id); }}
          verifyLabel="Verify Payment"
          verifySubmitting={submitting}
          onVerify={handleTopupVerify}
        />
        {eligibleForProof.length === 0 && (
          <p className="mt-3 text-xs text-warning-700 bg-warning-50 border border-warning-200 rounded-lg px-3 py-2">
            No pending top-up on your account yet. Make the payment above using the QR, and attach your screenshot once a pending top-up exists in the list below.
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <button onClick={() => setTab('received')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${tab === 'received' ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>Received ({received.length})</button>
        <button onClick={() => setTab('sent')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${tab === 'sent' ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>Sent ({sent.length})</button>
      </div>

      {list.length === 0 ? (
        <div className="table-shell">
          <EmptyState icon={<ArrowUpDown className="h-12 w-12" />} title="No top-ups" description={`No ${tab} top-ups found.`} />
        </div>
      ) : (
        <div className="space-y-3">
          {list.map(t => (
            <div key={t.id} className="card flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1"><span className="font-semibold text-gray-900">₹{t.amount}</span><StatusBadge status={t.status} /></div>
                <p className="text-sm text-gray-600">{tab === 'received' ? `From: ${t.sender_name || t.sender_id?.slice(0,8)}` : `To: ${t.receiver_name || t.receiver_id?.slice(0,8)}`}</p>
                <p className="text-xs text-gray-500">{new Date(t.created_at).toLocaleString()}</p>
              </div>
              <div className="flex gap-2">
                {tab === 'received' && t.status === 'payment_pending' && (
                  <button onClick={() => setProofModal(t)} className="btn-primary text-sm"><Upload className="h-4 w-4" /> Submit Proof</button>
                )}
                {t.screenshot_url && (
                  <a href={t.screenshot_url} target="_blank" rel="noopener noreferrer" className="btn-secondary text-sm"><Eye className="h-4 w-4" /> Screenshot</a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={!!proofModal} onClose={() => setProofModal(null)} title="Submit Payment Proof">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">Upload your payment screenshot for ₹{proofModal?.amount}</p>
          <input type="file" accept="image/*" className="input-field" onChange={e => setScreenshot(e.target.files[0])} />
          <input className="input-field" placeholder="Transaction/Reference ID" value={refId} onChange={e => setRefId(e.target.value)} />
          <button onClick={handleProof} disabled={submitting} className="btn-primary w-full">{submitting ? 'Submitting...' : 'Submit Proof'}</button>
        </div>
      </Modal>
    </div>
  );
}