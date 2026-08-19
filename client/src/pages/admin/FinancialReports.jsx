import { useState, useEffect } from 'react';
import api from '../../utils/api';
import { BarChart3, Download, RefreshCw, TrendingUp, TrendingDown, Clock, Users } from 'lucide-react';

export default function FinancialReports() {
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center"><BarChart3 className="h-5 w-5" /></div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Financial Reports</h1>
            <p className="text-sm text-gray-500 mt-0.5">Revenue summary and CSV exports</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="input-field w-auto py-2" />
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="input-field w-auto py-2" />
          <button onClick={fetchSummary} className="btn-primary py-2">Filter</button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><RefreshCw className="w-6 h-6 animate-spin text-gray-500" /></div>
      ) : summary ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Total Revenue', value: `₹${summary.totalRevenue.toLocaleString()}`, icon: TrendingUp, tile: 'bg-success-50 text-success-600' },
              { label: 'Pending Amount', value: `₹${summary.pendingAmount.toLocaleString()}`, icon: Clock, tile: 'bg-warning-50 text-warning-600' },
              { label: 'Total Top-ups', value: `₹${summary.totalTopups.toLocaleString()}`, icon: TrendingDown, tile: 'bg-info-50 text-info-600' },
              { label: 'Total Transactions', value: summary.totalTransactions, icon: Users, tile: 'bg-primary-50 text-primary-600' },
            ].map((card, i) => (
              <div key={i} className="stat-card">
                <div className="flex items-center gap-3">
                  <div className={`w-11 h-11 rounded-lg flex items-center justify-center ${card.tile}`}>
                    <card.icon size={20} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500">{card.label}</p>
                    <p className="text-xl font-bold text-gray-900">{card.value}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-lg bg-success-50 text-success-700 px-3 py-1.5 text-sm border border-success-100">
              Approved: <span className="font-semibold">{summary.approvedCount}</span>
            </div>
            <div className="rounded-lg bg-error-50 text-error-700 px-3 py-1.5 text-sm border border-error-100">
              Rejected: <span className="font-semibold">{summary.rejectedCount}</span>
            </div>
          </div>

          <div className="table-shell">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">Monthly Revenue</h3>
            </div>
            <div className="p-5 space-y-3">
              {Object.entries(summary.monthlyRevenue).map(([month, amount]) => {
                const pct = summary.totalRevenue > 0 ? Math.min(100, (amount / summary.totalRevenue) * 100) : 0;
                return (
                  <div key={month} className="flex items-center gap-3">
                    <span className="text-sm w-20 text-gray-600">{month}</span>
                    <div className="flex-1 h-6 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-primary-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-sm font-semibold text-gray-900 w-24 text-right">₹{amount.toLocaleString()}</span>
                  </div>
                );
              })}
              {Object.keys(summary.monthlyRevenue).length === 0 && (
                <p className="text-center py-4 text-sm text-gray-500">No data available</p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button onClick={() => downloadCSV('users')} className="btn-secondary"><Download size={16} /> Export Users CSV</button>
            <button onClick={() => downloadCSV('payments')} className="btn-secondary"><Download size={16} /> Export Payments CSV</button>
            <button onClick={() => downloadCSV('topups')} className="btn-secondary"><Download size={16} /> Export Top-ups CSV</button>
          </div>
        </>
      ) : null}
    </div>
  );
}