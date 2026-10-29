import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import { Receipt, Download } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import EmptyState from '../../components/EmptyState';
import LoadingSpinner from '../../components/LoadingSpinner';

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

  const viewReceipt = async (paymentId) => {
    // The receipt HTML endpoint requires a Bearer token, which a plain
    // window.open() cannot send (nor can it honour a non-relative API base
    // URL), so fetch it through the shared axios instance and open the
    // resulting document as a blob.
    try {
      const res = await api.get(`/receipts/${paymentId}/html`, { responseType: 'text' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/html' }));
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      toast.error('Failed to load receipt');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Payment Receipts" description="Download receipts for approved payments" />

      {loading ? (
        <LoadingSpinner />
      ) : receipts.length === 0 ? (
        <div className="table-shell">
          <EmptyState icon={<Receipt className="h-6 w-6" aria-hidden="true" />} title="No approved payments yet" description="Your downloadable receipts will appear here." />
        </div>
      ) : (
        <div className="table-shell">
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Receipt ID</th>
                  <th scope="col">Date</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Plan</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map(r => (
                  <tr key={r.paymentId}>
                    <td className="font-mono">{r.receiptId}</td>
                    <td>{new Date(r.createdAt).toLocaleDateString('en-IN')}</td>
                    <td className="font-semibold text-success-600 dark:text-success-400">₹{r.amount}</td>
                    <td>{r.planMonths} month(s)</td>
                    <td>
                      <button onClick={() => viewReceipt(r.paymentId)} className="btn btn-secondary btn-sm"><Download className="h-4 w-4" aria-hidden="true" /> View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
