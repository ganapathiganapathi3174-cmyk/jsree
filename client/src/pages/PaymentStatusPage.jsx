import { useState, useEffect } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { CreditCard, Eye, LogOut, Clock, XCircle, CheckCircle, ShieldAlert, Shield } from 'lucide-react';
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
        body: 'Payment verification failed. Please upload a valid payment screenshot.',
        tone: 'bg-error-50 border-error-200 text-error-800'
      };
    }
    if (pending) {
      const isManualReview = pending.status === 'manual_review';
      return {
        icon: <Clock className="h-5 w-5" />,
        title: isManualReview ? 'Payment needs re-verification' : 'Verifying your payment',
        body: isManualReview
          ? 'This payment was queued under an older review process. Upload your screenshot again and it will be verified automatically.'
          : 'Your account will be activated automatically once your registration payment is verified.',
        tone: 'bg-warning-50 border-warning-200 text-warning-800'
      };
    }
    if (loginPayment) {
      const rejectedLogin = loginPayment.paymentStatus === 'rejected';
      return {
        icon: rejectedLogin ? <XCircle className="h-5 w-5" /> : <Clock className="h-5 w-5" />,
        title: rejectedLogin ? 'Payment was not approved' : 'Verifying your payment',
        body: rejectedLogin
          ? 'Payment verification failed. Please upload a valid payment screenshot.'
          : 'Your account will be activated automatically once your registration payment is verified.',
        tone: rejectedLogin ? 'bg-error-50 border-error-200 text-error-800' : 'bg-warning-50 border-warning-200 text-warning-800'
      };
    }
    return null;
  })();

  if (loading) return <LoadingSpinner fullPage />;

  return (
    <div className="min-h-screen bg-transparent flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-6">
            <div className="w-10 h-10 bg-gradient-to-br from-primary-600 to-primary-700 rounded-lg flex items-center justify-center shadow-sm">
              <Shield className="h-5 w-5 text-white" />
            </div>
            <span className="text-2xl font-bold tracking-tight text-gray-900">JSREE</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Account Activation</h1>
          <p className="text-gray-500 mt-1">Track your registration payment status</p>
        </div>

        <div className="card p-6">
          {!token && !loginPayment ? (
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
                    <span className="font-semibold text-gray-900">₹{activePayment.expected_amount}</span>
                    <StatusBadge status={activePayment.status} />
                  </div>
                  <p className="text-sm text-gray-600">
                    Plan: ₹{activePayment.selected_plan} | Submitted: {new Date(activePayment.submitted_at).toLocaleString()}
                  </p>
                  {activePayment.rejection_reason && (
                    <p className="text-sm text-error-600">
                      Payment verification failed. Please upload a valid payment screenshot.
                    </p>
                  )}
                  {activePayment.screenshot_url && (
                    <button onClick={() => setSelected(activePayment)} className="btn-secondary text-sm mt-2">
                      <Eye className="h-4 w-4" /> View Screenshot
                    </button>
                  )}
                </div>
              )}

              {!activePayment && loginPayment && !token && (
                <div className="rounded-xl border border-gray-200 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-gray-900">₹{loginPayment.expectedAmount ?? 'N/A'}</span>
                    <StatusBadge status={loginPayment.paymentStatus || 'pending'} />
                  </div>
                  {loginPayment.selectedPlan && (
                    <p className="text-sm text-gray-600">Plan: ₹{loginPayment.selectedPlan}</p>
                  )}
                  {loginPayment.submittedAt && (
                    <p className="text-sm text-gray-600">Submitted: {new Date(loginPayment.submittedAt).toLocaleString()}</p>
                  )}
                  {loginPayment.rejectionReason && (
                    <p className="text-sm text-error-600">Reason: {loginPayment.rejectionReason}</p>
                  )}
                </div>
              )}

              {!activePayment && !loginPayment && payments.length === 0 && (
                <div className="text-center py-6">
                  <CheckCircle className="h-10 w-10 text-success-600 mx-auto mb-2" />
                  <p className="text-gray-600 text-sm">No pending payment. If you recently registered, your payment will appear here.</p>
                </div>
              )}

              <div className="border-t pt-4">
                <button onClick={logout} className="btn-secondary w-full text-sm">
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
        {selected?.screenshot_url && <img src={selected.screenshot_url} alt="Payment" className="w-full rounded-lg border border-gray-200" />}
      </Modal>
    </div>
  );
}