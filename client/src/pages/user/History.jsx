import { useState, useEffect } from 'react';
import { History as HistoryIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import PageHeader from '../../components/PageHeader';
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

  const filterTabs = [
    { key: 'all', label: 'All' },
    { key: 'payment', label: 'Payments' },
    { key: 'top-up', label: 'Top-Ups' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="History" description="Your payments and top-ups" />
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter history">
        {filterTabs.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)} aria-pressed={filter === f.key} className={`chip ${filter === f.key ? 'chip-active' : ''}`}>{f.label}</button>
        ))}
      </div>
      {items.length === 0 ? (
        <div className="table-shell">
          <EmptyState icon={<HistoryIcon className="h-6 w-6" aria-hidden="true" />} title="No history" description="Your transactions will appear here." />
        </div>
      ) : (
        <div className="table-shell divide-y divide-line/70">
          {items.map(i => (
            <div key={`${i.type}-${i.id}`} className="px-4 sm:px-5 py-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-ink">{i.type}</p>
                <p className="text-sm text-ink-muted mt-0.5">{new Date(i.date).toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-4 sm:gap-6">
                <p className="font-semibold text-ink">₹{i.amount}</p>
                <StatusBadge status={i.status} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
