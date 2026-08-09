import { useState, useEffect } from 'react';
import { History as HistoryIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import StatusBadge from '../../components/StatusBadge';
import EmptyState from '../../components/EmptyState';
import LoadingSpinner from '../../components/LoadingSpinner';

export default function History() {
  const [payments, setPayments] = useState([]);
  const [topups, setTopups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    Promise.all([
      api.get('/payments').then(r => setPayments(r.data.data || [])),
      api.get('/topups').then(r => setTopups(r.data.data || []))
    ]).catch(() => toast.error('Failed to load history')).finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner fullPage />;

  let items = [
    ...payments.map(p => ({ type: 'Payment', amount: p.expected_amount, status: p.status, date: p.submitted_at, id: p.id })),
    ...topups.map(t => ({ type: 'Top-Up', amount: t.amount, status: t.status, date: t.created_at, id: t.id }))
  ];
  if (filter !== 'all') items = items.filter(i => i.type.toLowerCase() === filter);
  items.sort((a, b) => new Date(b.date) - new Date(a.date));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">History</h1>
      <div className="flex gap-2">
        {['all', 'payment', 'top-up'].map(f => (
          <button key={f} onClick={() => setFilter(f)} className={`px-4 py-2 rounded-lg text-sm font-medium capitalize ${filter === f ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-700'}`}>{f}</button>
        ))}
      </div>
      {items.length === 0 ? (
        <EmptyState icon={<HistoryIcon className="h-12 w-12" />} title="No history" description="Your transactions will appear here." />
      ) : (
        <div className="space-y-3">
          {items.map(i => (
            <div key={`${i.type}-${i.id}`} className="card flex items-center justify-between">
              <div><p className="font-medium">{i.type}</p><p className="text-sm text-gray-500">{new Date(i.date).toLocaleString()}</p></div>
              <div className="text-right"><p className="font-semibold">₹{i.amount}</p><StatusBadge status={i.status} /></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
