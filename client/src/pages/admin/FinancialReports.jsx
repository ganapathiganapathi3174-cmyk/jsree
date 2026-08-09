import { useState, useEffect } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import api from '../../utils/api';
import { BarChart3, Download, RefreshCw, TrendingUp, TrendingDown, Clock, Users } from 'lucide-react';

export default function FinancialReports() {
  const { dark } = useTheme();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => { fetchSummary(); }, []);

  const fetchSummary = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      const { data } = await api.get(`/export/financial-summary?${params}`);
      setSummary(data);
    } catch (e) { /* ignore */ }
    setLoading(false);
  };

  const downloadCSV = async (type) => {
    try {
      const { data } = await api.get(`/export/${type}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${type}_export.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (e) { /* ignore */ }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 className={`w-8 h-8 ${dark ? 'text-indigo-400' : 'text-indigo-600'}`} />
          <h1 className={`text-2xl font-bold ${dark ? 'text-white' : 'text-gray-900'}`}>Financial Reports</h1>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={`px-3 py-1.5 rounded-lg text-sm border ${dark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300'}`} />
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={`px-3 py-1.5 rounded-lg text-sm border ${dark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300'}`} />
          <button onClick={fetchSummary} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700">Filter</button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><RefreshCw className={`w-6 h-6 animate-spin ${dark ? 'text-gray-400' : 'text-gray-500'}`} /></div>
      ) : summary ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Total Revenue', value: `₹${summary.totalRevenue.toLocaleString()}`, icon: TrendingUp, color: 'text-green-600' },
              { label: 'Pending Amount', value: `₹${summary.pendingAmount.toLocaleString()}`, icon: Clock, color: 'text-yellow-600' },
              { label: 'Total Top-ups', value: `₹${summary.totalTopups.toLocaleString()}`, icon: TrendingDown, color: 'text-blue-600' },
              { label: 'Total Transactions', value: summary.totalTransactions, icon: Users, color: 'text-purple-600' },
            ].map((card, i) => (
              <div key={i} className={`rounded-xl p-5 ${dark ? 'bg-gray-800' : 'bg-white border border-gray-200'}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${dark ? 'bg-gray-700' : 'bg-gray-100'}`}>
                    <card.icon size={20} className={card.color} />
                  </div>
                  <div>
                    <p className={`text-xs ${dark ? 'text-gray-400' : 'text-gray-500'}`}>{card.label}</p>
                    <p className={`text-xl font-bold ${dark ? 'text-white' : 'text-gray-900'}`}>{card.value}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-4">
            <div className={`rounded-lg px-3 py-1.5 text-sm ${dark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>
              Approved: <span className="font-semibold text-green-600">{summary.approvedCount}</span>
            </div>
            <div className={`rounded-lg px-3 py-1.5 text-sm ${dark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>
              Rejected: <span className="font-semibold text-red-600">{summary.rejectedCount}</span>
            </div>
          </div>

          <div className={`rounded-xl border overflow-hidden ${dark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
            <div className={`px-4 py-3 border-b ${dark ? 'border-gray-700' : 'border-gray-200'}`}>
              <h3 className={`font-semibold ${dark ? 'text-white' : 'text-gray-900'}`}>Monthly Revenue</h3>
            </div>
            <div className="p-4 space-y-2">
              {Object.entries(summary.monthlyRevenue).map(([month, amount]) => (
                <div key={month} className="flex items-center gap-3">
                  <span className={`text-sm w-20 ${dark ? 'text-gray-400' : 'text-gray-600'}`}>{month}</span>
                  <div className="flex-1 h-6 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.min(100, (amount / summary.totalRevenue) * 100)}%` }} />
                  </div>
                  <span className={`text-sm font-semibold ${dark ? 'text-white' : 'text-gray-900'}`}>₹{amount.toLocaleString()}</span>
                </div>
              ))}
              {Object.keys(summary.monthlyRevenue).length === 0 && (
                <p className={`text-center py-4 text-sm ${dark ? 'text-gray-400' : 'text-gray-500'}`}>No data available</p>
              )}
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => downloadCSV('users')} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700">
              <Download size={16} /> Export Users CSV
            </button>
            <button onClick={() => downloadCSV('payments')} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">
              <Download size={16} /> Export Payments CSV
            </button>
            <button onClick={() => downloadCSV('topups')} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
              <Download size={16} /> Export Top-ups CSV
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
