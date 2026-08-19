import { useState, useEffect } from 'react';
import { CreditCard, Eye } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import StatusBadge from '../../components/StatusBadge';
import Modal from '../../components/Modal';
import EmptyState from '../../components/EmptyState';
import LoadingSpinner from '../../components/LoadingSpinner';

export default function PaymentStatus() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    api.get('/payments').then(r => setPayments(r.data.data || []) ).catch(() => toast.error('Failed to load payments')).finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner fullPage />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Payment Status</h1>
        <p className="text-sm text-gray-500 mt-1">Your registration payment records</p>
      </div>
      {payments.length === 0 ? (
        <div className="table-shell">
          <EmptyState icon={<CreditCard className="h-12 w-12" />} title="No payments found" description="Your payment records will appear here after registration." />
        </div>
      ) : (
        <div className="space-y-4">
          {payments.map(p => (
            <div key={p.id} className="card flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2"><span className="font-semibold text-gray-900">₹{p.expected_amount}</span><StatusBadge status={p.status} /></div>
                <p className="text-sm text-gray-600">Plan: ₹{p.selected_plan} | Submitted: {new Date(p.submitted_at).toLocaleString()}</p>
                {p.verified_at && <p className="text-sm text-gray-500">Verified: {new Date(p.verified_at).toLocaleString()}</p>}
                {p.rejection_reason && <p className="text-sm text-error-600 mt-1">Reason: {p.rejection_reason}</p>}
              </div>
              {p.screenshot_url && <button onClick={() => setSelected(p)} className="btn-secondary text-sm w-full sm:w-auto"><Eye className="h-4 w-4" /> View Screenshot</button>}
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={!!selected} onClose={() => setSelected(null)} title="Payment Screenshot" size="lg">
        {selected?.screenshot_url && <img src={selected.screenshot_url} alt="Payment" className="w-full rounded-lg border border-gray-200" />}
      </Modal>
    </div>
  );
}