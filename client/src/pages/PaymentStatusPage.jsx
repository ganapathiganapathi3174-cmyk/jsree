import { useState, useEffect } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { CreditCard, Eye, LogOut, Clock, XCircle, CheckCircle, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';
import LoadingSpinner from '../components/LoadingSpinner';

export default function PaymentStatusPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const loginPayment = location.state?.payment || null;

  const token = localStorage.getItem('token');
  const userStr = localStorage.getItem('user');
  const user = userStr ? JSON.parse(userStr) : null;

  useEffect(() => {
    if (!token || !user) {
      setLoading(false);
      return;
    }
    if (user.status === 'active' || user.role === 'admin') {
      navigate(user.role === 'admin' ? '/admin' : '/dashboard', { replace: true });
      return;
    }
    api.get('/payments')
      .then(r => setPayments(r.data.data || []))
      .catch(() => toast.error('Failed to load payment status'))
      .finally(() => setLoading(false));
  }, []);

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    toast.success('Logged out');
    navigate('/login');
  };

  const pending = payments.find(p => p.status === 'pending') || payments[0] || null;
  const rejected = payments.find(p => p.status === 'rejected') || null;
  const activePayment = pending || rejected;

  const banner = (() => {
    if (rejected) {
      return {
        icon: <XCircle className="h-5 w-5" />,
        title: 'Payment was not approved',
        body: rejected.rejection_reason || 'Your payment could not be approved. Please contact support.',
        tone: 'bg-red-50 border-red-200 text-red-800'
      };
    }
    if (pending) {
      return {
        icon: <Clock className="h-5 w-5" />,
        title: 'Payment under review',
        body: 'Your account is pending activation. You will be able to access the dashboard once your registration payment is approved.',
        tone: 'bg-amber-50 border-amber-200 text-amber-800'
      };
    }
    if (loginPayment) {
      const rejectedLogin = loginPayment.paymentStatus === 'rejected';
      return {
        icon: rejectedLogin ? <XCircle className="h-5 w-5" /> : <Clock className="h-5 w-5" />,
        title: rejectedLogin ? 'Payment was not approved' : 'Payment under review',
        body: rejectedLogin
          ? (loginPayment.rejectionReason || 'Your payment could not be approved. Please contact support.')
          : 'Your account is pending activation. You will be able to access the dashboard once your registration payment is approved.',
        tone: rejectedLogin ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-800'
      };
    }
    return null;
  })();

  if (loading) return <LoadingSpinner fullPage />;

  return (
    <div className="min-h-screen bg-transparent flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <Link to="/" className="text-2xl font-bold tracking-wide text-white">JSREE</Link>
          <h1 className="text-2xl font-bold text-white mt-4">Account Activation</h1>
          <p className="text-indigo-100/80 mt-1">Track your registration payment status</p>
        </div>

        <div className="card bg-white/90 backdrop-blur-xl rounded-xl border border-white/20 shadow-2xl p-6">
          {!token || !user ? (
            <div className="text-center py-8 space-y-4">
              <ShieldAlert className="h-12 w-12 text-gray-300 mx-auto" />
              <p className="text-gray-600">Sign in to check your payment status.</p>
              <button onClick={() => navigate('/login')} className="btn-primary w-full">Go to Login</button>
            </div>
          ) : (
            <div className="space-y-4">
              {banner && (
                <div className={`flex items-start gap-3 rounded-xl border p-4 ${banner.tone}`}>
                  <span className="mt-0.5">{banner.icon}</span>
                  <div>
                    <p className="font-semibold">{banner.title}</p>
                    <p className="text-sm mt-1">{banner.body}</p>
                  </div>
                </div>
              )}

              {activePayment && (
                <div className="rounded-xl border border-gray-200 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">₹{activePayment.expected_amount}</span>
                    <StatusBadge status={activePayment.status} />
                  </div>
                  <p className="text-sm text-gray-600">
                    Plan: ₹{activePayment.selected_plan} | Submitted: {new Date(activePayment.submitted_at).toLocaleString()}
                  </p>
                  {activePayment.rejection_reason && (
                    <p className="text-sm text-red-600">Reason: {activePayment.rejection_reason}</p>
                  )}
                  {activePayment.screenshot_url && (
                    <button onClick={() => setSelected(activePayment)} className="btn-secondary flex items-center gap-2 text-sm mt-2">
                      <Eye className="h-4 w-4" /> View Screenshot
                    </button>
                  )}
                </div>
              )}

              {!activePayment && !loginPayment && payments.length === 0 && (
                <div className="text-center py-6">
                  <CheckCircle className="h-10 w-10 text-green-500 mx-auto mb-2" />
                  <p className="text-gray-600 text-sm">No pending payment. If you recently registered, your payment will appear here.</p>
                </div>
              )}

              <div className="border-t pt-4">
                <button onClick={logout} className="btn-secondary w-full flex items-center justify-center gap-2 text-sm">
                  <LogOut className="h-4 w-4" /> Logout
                </button>
                <p className="text-center text-xs text-gray-500 mt-3">
                  Need help? Contact support at <span className="font-medium">support@referralhub.com</span>
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <Modal isOpen={!!selected} onClose={() => setSelected(null)} title="Payment Screenshot" size="lg">
        {selected?.screenshot_url && <img src={selected.screenshot_url} alt="Payment" className="w-full rounded-lg" />}
      </Modal>
    </div>
  );
}
