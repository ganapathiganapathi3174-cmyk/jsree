import { useState, useEffect } from 'react';
import api from '../../utils/api';
import { Wallet as WalletIcon, ArrowUpRight, ArrowDownLeft, RefreshCw, TrendingUp } from 'lucide-react';

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
    if (type === 'credit') return { tile: 'bg-success-50 text-success-600', text: 'text-success-600', sign: '+' };
    if (type === 'debit') return { tile: 'bg-error-50 text-error-600', text: 'text-error-600', sign: '-' };
    return { tile: 'bg-info-50 text-info-600', text: 'text-info-600', sign: '' };
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Wallet</h1>
        <p className="text-sm text-gray-500 mt-1">Your referral earnings balance</p>
      </div>

      <div className="rounded-xl bg-primary-600 text-white p-6 shadow-card">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm opacity-80">Available Balance</p>
            <p className="text-4xl font-bold mt-1">₹{parseFloat(balance).toFixed(2)}</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center">
            <WalletIcon className="h-6 w-6" />
          </div>
        </div>
        <div className="flex items-center gap-2 mt-4 text-sm opacity-80">
          <TrendingUp size={16} />
          <span>Referral bonuses credited here</span>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {['', 'credit', 'debit', 'refund'].map(type => (
          <button
            key={type}
            onClick={() => setFilter(type)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${filter === type ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
          >
            {type === '' ? 'All' : type.charAt(0).toUpperCase() + type.slice(1)}
          </button>
        ))}
      </div>

      <div className="table-shell overflow-hidden">
        {loading && transactions.length === 0 ? (
          <div className="p-8 text-center">
            <RefreshCw className="w-6 h-6 mx-auto animate-spin text-gray-500" />
            <p className="mt-2 text-sm text-gray-500">Loading...</p>
          </div>
        ) : transactions.length === 0 ? (
          <div className="p-8 text-center">
            <WalletIcon className="w-12 h-12 mx-auto text-gray-300" />
            <p className="mt-2 text-gray-500">No transactions yet</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {transactions.map(tx => {
              const tone = typeTone(tx.type);
              return (
                <div key={tx.id} className="px-4 py-3 flex items-center gap-4 hover:bg-gray-50 transition-colors">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${tone.tile}`}>
                    {tx.type === 'credit' ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{tx.description}</p>
                    <p className="text-xs text-gray-500">
                      {new Date(tx.created_at).toLocaleString('en-IN')}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-semibold ${tone.text}`}>
                      {tone.sign}₹{parseFloat(tx.amount).toFixed(2)}
                    </p>
                    <p className="text-xs text-gray-400">
                      Bal: ₹{parseFloat(tx.balance_after).toFixed(2)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {pagination.totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-200 text-center">
            <button onClick={() => fetchTransactions(pagination.page + 1)} className="text-sm text-primary-600 hover:text-primary-700 font-medium">
              Load more ({pagination.total} total)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}