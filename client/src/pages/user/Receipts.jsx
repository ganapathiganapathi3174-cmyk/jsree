import { useState, useEffect } from 'react';
import api from '../../utils/api';
import { Receipt, Download, RefreshCw } from 'lucide-react';

export default function Receipts() {
  const [receipts, setReceipts] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1 });
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchReceipts(1); }, []);

  const fetchReceipts = async (page = 1) => {
    setLoading(true);
    try {
      const { data } = await api.get(`/receipts/my-receipts?page=${page}&limit=10`);
      if (page === 1) setReceipts(data.receipts);
      else setReceipts(prev => [...prev, ...data.receipts]);
      setPagination(data.pagination);
    } catch (e) { /* ignore */ }
    setLoading(false);
  };

  const viewReceipt = (paymentId) => {
    window.open(`/api/receipts/${paymentId}/html`, '_blank');
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Payment Receipts</h1>
        <p className="text-sm text-gray-500 mt-1">Download receipts for approved payments</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><RefreshCw className="w-6 h-6 animate-spin text-gray-500" /></div>
      ) : receipts.length === 0 ? (
        <div className="table-shell text-center py-12 text-gray-500">
          <Receipt className="w-12 h-12 mx-auto mb-3 opacity-50 text-gray-300" />
          <p>No approved payments yet</p>
        </div>
      ) : (
        <div className="table-shell overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="bg-gray-50/60">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Receipt ID</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Plan</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {receipts.map(r => (
                <tr key={r.paymentId} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-sm font-mono text-gray-600">{r.receiptId}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{new Date(r.createdAt).toLocaleDateString('en-IN')}</td>
                  <td className="px-4 py-3 text-sm font-semibold text-success-600">₹{r.amount}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{r.planMonths} month(s)</td>
                  <td className="px-4 py-3">
                    <button onClick={() => viewReceipt(r.paymentId)} className="btn-secondary py-1.5 text-sm"><Download size={14} /> View</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}