import { useState, useEffect } from 'react';
import api from '../../utils/api';
import { Wallet as WalletIcon, ArrowUpRight, ArrowDownLeft, TrendingUp } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import EmptyState from '../../components/EmptyState';
import LoadingSpinner from '../../components/LoadingSpinner';

export default function Wallet() {
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    fetchBalance();
    fetchTransactions(1);
  }, [filter]);

  const fetchBalance = async () => {
    try {
      const { data } = await api.get('/wallet/balance');
      setBalance(data.balance);
    } catch (e) { /* ignore */ }
  };

  const fetchTransactions = async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 15 });
      if (filter) params.append('type', filter);
      const { data } = await api.get(`/wallet/transactions?${params}`);
      if (page === 1) {
        setTransactions(data.transactions);
      } else {
        setTransactions(prev => [...prev, ...data.transactions]);
      }
      setPagination(data.pagination);
    } catch (e) { /* ignore */ }
    setLoading(false);
  };

  const typeTone = (type) => {
    if (type === 'credit') return { tile: 'bg-success-500/10 text-success-600 dark:text-success-400', text: 'text-success-600 dark:text-success-400', sign: '+' };
    if (type === 'debit') return { tile: 'bg-error-500/10 text-error-600 dark:text-error-400', text: 'text-error-600 dark:text-error-400', sign: '-' };
    return { tile: 'bg-info-500/10 text-info-600 dark:text-info-400', text: 'text-info-600 dark:text-info-400', sign: '' };
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Wallet" description="Your referral earnings balance" />

      <div className="rounded-card bg-primary-600 text-white p-6 shadow-card">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-primary-100">Available Balance</p>
            <p className="text-4xl font-bold mt-1">₹{parseFloat(balance).toFixed(2)}</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-primary-500/40 flex items-center justify-center shrink-0">
            <WalletIcon className="h-6 w-6" aria-hidden="true" />
          </div>
        </div>
        <div className="flex items-center gap-2 mt-4 text-sm text-primary-100">
          <TrendingUp size={16} aria-hidden="true" />
          <span>Referral bonuses credited here</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter transactions">
        {['', 'credit', 'debit', 'refund'].map(type => (
          <button
            key={type}
            onClick={() => setFilter(type)}
            aria-pressed={filter === type}
            className={`chip ${filter === type ? 'chip-active' : ''}`}
          >
            {type === '' ? 'All' : type.charAt(0).toUpperCase() + type.slice(1)}
          </button>
        ))}
      </div>

      <div className="table-shell">
        {loading && transactions.length === 0 ? (
          <LoadingSpinner />
        ) : transactions.length === 0 ? (
          <EmptyState icon={<WalletIcon className="h-6 w-6" aria-hidden="true" />} title="No transactions yet" description="Your wallet transactions will appear here." />
        ) : (
          <div className="divide-y divide-line/70">
            {transactions.map(tx => {
              const tone = typeTone(tx.type);
              return (
                <div key={tx.id} className="px-4 py-3.5 flex items-center gap-4 hover:bg-surface-2/60 transition-colors">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${tone.tile}`}>
                    {tx.type === 'credit' ? <ArrowDownLeft size={18} aria-hidden="true" /> : <ArrowUpRight size={18} aria-hidden="true" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink">{tx.description}</p>
                    <p className="text-xs text-ink-faint mt-0.5">
                      {new Date(tx.created_at).toLocaleString('en-IN')}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-sm font-semibold ${tone.text}`}>
                      {tone.sign}₹{parseFloat(tx.amount).toFixed(2)}
                    </p>
                    <p className="text-xs text-ink-faint mt-0.5">
                      Bal: ₹{parseFloat(tx.balance_after).toFixed(2)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {pagination.totalPages > 1 && (
          <div className="px-4 py-3 border-t border-line text-center">
            <button onClick={() => fetchTransactions(pagination.page + 1)} className="btn btn-secondary btn-sm">
              Load more ({pagination.total} total)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
