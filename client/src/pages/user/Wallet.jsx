import { useState, useEffect } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import api from '../../utils/api';
import { Wallet as WalletIcon, ArrowUpRight, ArrowDownLeft, RefreshCw, TrendingUp } from 'lucide-react';

export default function Wallet() {
  const { dark } = useTheme();
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

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <WalletIcon className={`w-8 h-8 ${dark ? 'text-indigo-400' : 'text-indigo-600'}`} />
        <h1 className={`text-2xl font-bold ${dark ? 'text-white' : 'text-gray-900'}`}>Wallet</h1>
      </div>

      <div className={`rounded-xl p-6 ${dark ? 'bg-gradient-to-br from-gray-800 to-gray-900' : 'bg-gradient-to-br from-indigo-500 to-purple-600'} text-white`}>
        <p className="text-sm opacity-80">Available Balance</p>
        <p className="text-4xl font-bold mt-1">₹{parseFloat(balance).toFixed(2)}</p>
        <div className="flex items-center gap-2 mt-3 text-sm opacity-70">
          <TrendingUp size={16} />
          <span>Referral bonuses credited here</span>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {['', 'credit', 'debit', 'refund'].map(type => (
          <button
            key={type}
            onClick={() => setFilter(type)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${filter === type ? (dark ? 'bg-indigo-600 text-white' : 'bg-indigo-600 text-white') : (dark ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}`}
          >
            {type === '' ? 'All' : type.charAt(0).toUpperCase() + type.slice(1)}
          </button>
        ))}
      </div>

      <div className={`rounded-xl border overflow-hidden ${dark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
        {loading && transactions.length === 0 ? (
          <div className="p-8 text-center">
            <RefreshCw className={`w-6 h-6 mx-auto animate-spin ${dark ? 'text-gray-400' : 'text-gray-500'}`} />
            <p className={`mt-2 text-sm ${dark ? 'text-gray-400' : 'text-gray-500'}`}>Loading...</p>
          </div>
        ) : transactions.length === 0 ? (
          <div className="p-8 text-center">
            <WalletIcon className={`w-12 h-12 mx-auto ${dark ? 'text-gray-600' : 'text-gray-300'}`} />
            <p className={`mt-2 ${dark ? 'text-gray-400' : 'text-gray-500'}`}>No transactions yet</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {transactions.map(tx => (
              <div key={tx.id} className={`px-4 py-3 flex items-center gap-4 ${dark ? 'hover:bg-gray-750' : 'hover:bg-gray-50'}`}>
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${tx.type === 'credit' ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400' : tx.type === 'debit' ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' : 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'}`}>
                  {tx.type === 'credit' ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${dark ? 'text-white' : 'text-gray-900'}`}>{tx.description}</p>
                  <p className={`text-xs ${dark ? 'text-gray-400' : 'text-gray-500'}`}>
                    {new Date(tx.created_at).toLocaleString('en-IN')}
                  </p>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-semibold ${tx.type === 'credit' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {tx.type === 'credit' ? '+' : '-'}₹{parseFloat(tx.amount).toFixed(2)}
                  </p>
                  <p className={`text-xs ${dark ? 'text-gray-500' : 'text-gray-400'}`}>
                    Bal: ₹{parseFloat(tx.balance_after).toFixed(2)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
        {pagination.totalPages > 1 && (
          <div className={`px-4 py-3 border-t text-center ${dark ? 'border-gray-700' : 'border-gray-200'}`}>
            <button onClick={() => fetchTransactions(pagination.page + 1)} className="text-sm text-indigo-500 hover:text-indigo-600">
              Load more ({pagination.total} total)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
