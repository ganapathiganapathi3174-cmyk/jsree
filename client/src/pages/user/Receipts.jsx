import { useState, useEffect } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import api from '../../utils/api';
import { Receipt, Download, RefreshCw } from 'lucide-react';

export default function Receipts() {
  const { dark } = useTheme();
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
      <div className="flex items-center gap-3">
        <Receipt className={`w-8 h-8 ${dark ? 'text-indigo-400' : 'text-indigo-600'}`} />
        <h1 className={`text-2xl font-bold ${dark ? 'text-white' : 'text-gray-900'}`}>Payment Receipts</h1>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><RefreshCw className={`w-6 h-6 animate-spin ${dark ? 'text-gray-400' : 'text-gray-500'}`} /></div>
      ) : receipts.length === 0 ? (
        <div className={`text-center py-12 ${dark ? 'text-gray-400' : 'text-gray-500'}`}>
          <Receipt className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No approved payments yet</p>
        </div>
      ) : (
        <div className={`rounded-xl border overflow-hidden ${dark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
          <table className="w-full">
            <thead className={`${dark ? 'bg-gray-750' : 'bg-gray-50'}`}>
              <tr>
                <th className={`px-4 py-3 text-left text-xs font-medium uppercase ${dark ? 'text-gray-400' : 'text-gray-500'}`}>Receipt ID</th>
                <th className={`px-4 py-3 text-left text-xs font-medium uppercase ${dark ? 'text-gray-400' : 'text-gray-500'}`}>Date</th>
                <th className={`px-4 py-3 text-left text-xs font-medium uppercase ${dark ? 'text-gray-400' : 'text-gray-500'}`}>Amount</th>
                <th className={`px-4 py-3 text-left text-xs font-medium uppercase ${dark ? 'text-gray-400' : 'text-gray-500'}`}>Plan</th>
                <th className={`px-4 py-3 text-left text-xs font-medium uppercase ${dark ? 'text-gray-400' : 'text-gray-500'}`}>Action</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${dark ? 'divide-gray-700' : 'divide-gray-100'}`}>
              {receipts.map(r => (
                <tr key={r.paymentId} className={dark ? 'hover:bg-gray-750' : 'hover:bg-gray-50'}>
                  <td className={`px-4 py-3 text-sm font-mono ${dark ? 'text-gray-300' : 'text-gray-600'}`}>{r.receiptId}</td>
                  <td className={`px-4 py-3 text-sm ${dark ? 'text-gray-300' : 'text-gray-600'}`}>{new Date(r.createdAt).toLocaleDateString('en-IN')}</td>
                  <td className="px-4 py-3 text-sm font-semibold text-green-600">₹{r.amount}</td>
                  <td className={`px-4 py-3 text-sm ${dark ? 'text-gray-300' : 'text-gray-600'}`}>{r.planMonths} month(s)</td>
                  <td className="px-4 py-3">
                    <button onClick={() => viewReceipt(r.paymentId)} className="flex items-center gap-1 text-sm text-indigo-500 hover:text-indigo-600">
                      <Download size={14} /> View
                    </button>
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
