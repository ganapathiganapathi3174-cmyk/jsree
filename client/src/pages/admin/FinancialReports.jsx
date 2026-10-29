import { useState, useEffect } from 'react';
import api from '../../utils/api';
import { Download, TrendingUp, TrendingDown, Clock, Users } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import LoadingSpinner from '../../components/LoadingSpinner';

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
      <PageHeader
        title="Financial Reports"
        description="Revenue summary and CSV exports"
        actions={(
          <>
            <input type="date" aria-label="Start date" value={startDate} onChange={e => setStartDate(e.target.value)} className="input-field w-auto" />
            <input type="date" aria-label="End date" value={endDate} onChange={e => setEndDate(e.target.value)} className="input-field w-auto" />
            <button onClick={fetchSummary} className="btn btn-primary">Filter</button>
          </>
        )}
      />

      {loading ? (
        <LoadingSpinner />
      ) : summary ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Total Revenue', value: `₹${summary.totalRevenue.toLocaleString()}`, icon: TrendingUp, tile: 'bg-success-500/10 text-success-600 dark:text-success-400' },
              { label: 'Pending Amount', value: `₹${summary.pendingAmount.toLocaleString()}`, icon: Clock, tile: 'bg-warning-500/10 text-warning-600 dark:text-warning-400' },
              { label: 'Total Top-ups', value: `₹${summary.totalTopups.toLocaleString()}`, icon: TrendingDown, tile: 'bg-info-500/10 text-info-600 dark:text-info-400' },
              { label: 'Total Transactions', value: summary.totalTransactions, icon: Users, tile: 'bg-primary-500/10 text-primary-600 dark:text-primary-400' },
            ].map((card, i) => (
              <div key={i} className="stat-card">
                <div className="flex items-center gap-3">
                  <div className={`w-11 h-11 rounded-lg flex items-center justify-center shrink-0 ${card.tile}`}>
                    <card.icon size={20} aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-ink-muted">{card.label}</p>
                    <p className="text-xl font-bold text-ink tabular-nums">{card.value}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="badge badge-success">Approved: <span className="font-semibold">{summary.approvedCount}</span></span>
            <span className="badge badge-error">Rejected: <span className="font-semibold">{summary.rejectedCount}</span></span>
          </div>

          <div className="table-shell">
            <div className="px-5 py-4 border-b border-line">
              <h3 className="font-semibold text-ink">Monthly Revenue</h3>
            </div>
            <div className="p-5 space-y-3">
              {Object.entries(summary.monthlyRevenue).map(([month, amount]) => {
                const pct = summary.totalRevenue > 0 ? Math.min(100, (amount / summary.totalRevenue) * 100) : 0;
                return (
                  <div key={month} className="flex items-center gap-3">
                    <span className="text-sm w-20 shrink-0 text-ink-muted">{month}</span>
                    <div className="flex-1 h-2.5 bg-surface-2 rounded-full overflow-hidden min-w-0">
                      <div className="h-full bg-primary-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-sm font-semibold text-ink w-24 shrink-0 text-right tabular-nums">₹{amount.toLocaleString()}</span>
                  </div>
                );
              })}
              {Object.keys(summary.monthlyRevenue).length === 0 && (
                <p className="text-center py-4 text-sm text-ink-muted">No data available</p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button onClick={() => downloadCSV('users')} className="btn btn-secondary"><Download size={16} aria-hidden="true" /> Export Users CSV</button>
            <button onClick={() => downloadCSV('payments')} className="btn btn-secondary"><Download size={16} aria-hidden="true" /> Export Payments CSV</button>
            <button onClick={() => downloadCSV('topups')} className="btn btn-secondary"><Download size={16} aria-hidden="true" /> Export Top-ups CSV</button>
          </div>
        </>
      ) : null}
    </div>
  );
}
