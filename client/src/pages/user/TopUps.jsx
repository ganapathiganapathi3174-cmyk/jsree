import { useState, useEffect } from 'react';
import { ArrowUpDown, Upload, Eye } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import StatusBadge from '../../components/StatusBadge';
import Modal from '../../components/Modal';
import EmptyState from '../../components/EmptyState';
import LoadingSpinner from '../../components/LoadingSpinner';

export default function TopUps() {
  const [topups, setTopups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('received');
  const [proofModal, setProofModal] = useState(null);
  const [screenshot, setScreenshot] = useState(null);
  const [refId, setRefId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  const load = () => api.get('/topups').then(r => setTopups(r.data.data || [])).catch(() => toast.error('Failed to load top-ups')).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const received = topups.filter(t => t.receiver_id === user.id);
  const sent = topups.filter(t => t.sender_id === user.id);
  const list = tab === 'received' ? received : sent;

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

  if (loading) return <LoadingSpinner fullPage />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Top-Ups</h1>
      <div className="flex gap-2">
        <button onClick={() => setTab('received')} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'received' ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-700'}`}>Received ({received.length})</button>
        <button onClick={() => setTab('sent')} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'sent' ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-700'}`}>Sent ({sent.length})</button>
      </div>

      {list.length === 0 ? (
        <EmptyState icon={<ArrowUpDown className="h-12 w-12" />} title="No top-ups" description={`No ${tab} top-ups found.`} />
      ) : (
        <div className="space-y-3">
          {list.map(t => (
            <div key={t.id} className="card flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1"><span className="font-semibold">₹{t.amount}</span><StatusBadge status={t.status} /></div>
                <p className="text-sm text-gray-600">{tab === 'received' ? `From: ${t.sender_name || t.sender_id?.slice(0,8)}` : `To: ${t.receiver_name || t.receiver_id?.slice(0,8)}`}</p>
                <p className="text-xs text-gray-500">{new Date(t.created_at).toLocaleString()}</p>
              </div>
              <div className="flex gap-2">
                {tab === 'received' && t.status === 'payment_pending' && (
                  <button onClick={() => setProofModal(t)} className="btn-primary text-sm flex items-center gap-1"><Upload className="h-3 w-3" /> Submit Proof</button>
                )}
                {t.screenshot_url && (
                  <a href={t.screenshot_url} target="_blank" rel="noopener noreferrer" className="btn-secondary text-sm flex items-center gap-1"><Eye className="h-3 w-3" /> Screenshot</a>
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
