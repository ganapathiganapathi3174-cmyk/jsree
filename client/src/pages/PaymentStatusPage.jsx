import { useState, useEffect } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { CreditCard, Eye, LogOut, Clock, XCircle, CheckCircle, ShieldAlert, Shield, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';
import LoadingSpinner from '../components/LoadingSpinner';
import PaymentScreenshot from '../components/PaymentScreenshot';
import QRPaymentSection from '../components/QRPaymentSection';
import ThemeToggle from '../components/ThemeToggle';

export default function PaymentStatusPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [retryPayment, setRetryPayment] = useState(null);
  const [publicConfig, setPublicConfig] = useState(null);
  const [retryBusy, setRetryBusy] = useState(false);
  const loginPayment = location.state?.payment || null;

  const token = localStorage.getItem('token');
  const userStr = localStorage.getItem('user');
  const user = userStr ? JSON.parse(userStr) : null;

  const loadPayments = () => api.get('/payments').then(r => setPayments(r.data.data || []));

  useEffect(() => {
    if (!token || !user) {
      setLoading(false);
      return;
    }
    if (user.status === 'active' || user.role === 'admin') {
      navigate(user.role === 'admin' ? '/admin' : '/dashboard', { replace: true });
      return;
    }
    loadPayments()
      .catch(() => toast.error('Failed to load payment status'))
      .finally(() => setLoading(false));
    api.get('/config/public').then(r => setPublicConfig(r.data.data || r.data)).catch(() => {});
  }, []);

  // ── Retry flow (rejected payment) ──
  // A rejected registration payment can be retried by creating a NEW
  // server-side payment request (fresh amount resolution + fresh expiry).
  // The expected amount is NEVER taken from the client — the backend
  // re-resolves it from the selected plan.
  const startRetry = async () => {
    if (retryBusy) return;
    const plan = rejected?.selected_plan || pending?.selected_plan || 120;
    setRetryBusy(true);
    try {
      const res = await api.post('/payments', { plan: String(plan) });
      setRetryPayment(res.data.data);
      toast.success('New payment request created. Pay and upload your screenshot below.');
    } catch (err) {
      const code = err.response?.data?.code;
      if (code === 'PENDING_EXISTS') {
        toast.error('You already have a pending payment. Please upload its screenshot below.');
        setRetryPayment(pending);
      } else if (code === 'PAYMENT_EXISTS') {
        toast.success('Your payment is already approved.');
        navigate('/dashboard', { replace: true });
      } else {
        toast.error(err.response?.data?.message || 'Could not create a new payment request');
      }
    } finally {
      setRetryBusy(false);
    }
  };

  const handleRetryVerify = async (file) => {
    if (!retryPayment?.id || retryBusy) return;
    setRetryBusy(true);
    try {
      const fd = new FormData();
      fd.append('screenshot', file);
      const uploadRes = await api.post(`/payments/${retryPayment.id}/screenshot`, fd);
      const verification = uploadRes.data.data?.verification;
      if (verification?.status === 'approved') {
        toast.success('Payment approved! Your account is now active.');
        try {
          const profRes = await api.get('/users/profile');
          localStorage.setItem('user', JSON.stringify(profRes.data.data));
        } catch { /* keep existing localStorage user */ }
        navigate('/dashboard', { replace: true });
        return;
      }
      if (verification?.status === 'rejected') {
        toast.error('Verification failed. You can create another payment request and try again.');
      } else if (verification?.status === 'manual_review') {
        toast('Your payment is being reviewed by our team. We will notify you once it is verified.', { icon: '⏳' });
      } else if (verification?.inconclusive) {
        toast.error('We could not read your screenshot clearly. Your payment is still pending — please upload a clearer screenshot.');
      } else {
        toast.error('Verification could not finish. Please try again.');
      }
      setRetryPayment(null);
      await loadPayments();
    } catch (err) {
      const code = err.response?.data?.code;
      if (code === 'PAYMENT_EXPIRED') {
        toast.error('Payment request expired. Please create a new payment request.');
        setRetryPayment(null);
      } else if (code === 'OCR_TIMEOUT') {
        toast.error('Verification took too long. Please upload the screenshot again.');
      } else if (code === 'DUPLICATE_REQUEST') {
        toast.error('A verification for this screenshot is already in progress.');
      } else {
        toast.error(err.response?.data?.message || 'Verification failed');
      }
    } finally {
      setRetryBusy(false);
    }
  };

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
        icon: <XCircle className="h-5 w-5 shrink-0" />,
        title: 'Payment was not approved',
        body: 'Payment verification failed. Please upload a valid payment screenshot.',
        tone: 'callout-error'
      };
    }
    if (pending) {
      return {
        icon: <Clock className="h-5 w-5 shrink-0" />,
        title: 'Verifying your payment',
        body: 'Your account will be activated automatically once your registration payment is verified.',
        tone: 'callout-warning'
      };
    }
    if (loginPayment) {
      const rejectedLogin = loginPayment.paymentStatus === 'rejected';
      return {
        icon: rejectedLogin ? <XCircle className="h-5 w-5 shrink-0" /> : <Clock className="h-5 w-5 shrink-0" />,
        title: rejectedLogin ? 'Payment was not approved' : 'Verifying your payment',
        body: rejectedLogin
          ? 'Payment verification failed. Please upload a valid payment screenshot.'
          : 'Your account will be activated automatically once your registration payment is verified.',
        tone: rejectedLogin ? 'callout-error' : 'callout-warning'
      };
    }
    return null;
  })();

  if (loading) return <LoadingSpinner fullPage />;

  return (
    <div className="min-h-screen landing-bg flex items-center justify-center p-4 py-10">
      <div className="fixed top-4 right-4 z-20">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-lg relative z-10">
        <div className="text-center mb-7">
          <Link to="/" className="inline-flex items-center justify-center gap-2.5 mb-5" aria-label="JSREE home">
            <span className="w-10 h-10 bg-primary-600 rounded-lg flex items-center justify-center">
              <Shield className="h-5 w-5 text-white" aria-hidden="true" />
            </span>
            <span className="text-2xl font-bold tracking-tight text-ink">JSREE</span>
          </Link>
          <h1 className="text-2xl sm:text-3xl font-bold text-ink">Account Activation</h1>
          <p className="text-ink-muted mt-1 text-sm">Track your registration payment status</p>
        </div>

        <div className="card">
          {!token && !loginPayment ? (
            <div className="text-center py-8 space-y-4">
              <ShieldAlert className="h-10 w-10 text-ink-faint mx-auto" aria-hidden="true" />
              <p className="text-ink-muted text-sm">Sign in to check your payment status.</p>
              <button onClick={() => navigate('/login')} className="btn btn-primary w-full">Go to Login</button>
            </div>
          ) : (
            <div className="space-y-4">
              {banner && (
                <div className={`callout ${banner.tone}`} role="status">
                  <span className="mt-px">{banner.icon}</span>
                  <div>
                    <p className="font-semibold">{banner.title}</p>
                    <p className="text-sm mt-1 opacity-90">{banner.body}</p>
                  </div>
                </div>
              )}

              {activePayment && (
                <div className="rounded-lg border border-line p-4 space-y-2 bg-surface-2/50">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-ink text-lg">₹{activePayment.expected_amount}</span>
                    <StatusBadge status={activePayment.status} />
                  </div>
                  <p className="text-sm text-ink-muted">
                    Plan: ₹{activePayment.selected_plan} | Submitted: {new Date(activePayment.submitted_at).toLocaleString()}
                  </p>
                  {activePayment.rejection_reason && (
                    <p className="text-sm text-error-600 dark:text-error-400">
                      Payment verification failed. Please upload a valid payment screenshot.
                    </p>
                  )}
                  {activePayment.screenshot_url && (
                    <button onClick={() => setSelected(activePayment)} className="btn btn-secondary btn-sm mt-1">
                      <Eye className="h-4 w-4" aria-hidden="true" /> View Screenshot
                    </button>
                  )}
                </div>
              )}

              {token && rejected && !retryPayment && (
                <button
                  onClick={startRetry}
                  disabled={retryBusy}
                  className="btn btn-primary btn-lg w-full"
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  {retryBusy ? 'Creating…' : 'Create New Payment Request'}
                </button>
              )}

              {token && retryPayment && (
                <QRPaymentSection
                  amount={retryPayment.expected_amount}
                  upiId={retryPayment.receiver_upi || publicConfig?.receiver_upi}
                  verifyLabel="Verify Payment"
                  verifySubmitting={retryBusy}
                  onVerify={handleRetryVerify}
                  onRecreate={() => setRetryPayment(null)}
                  expiresAt={retryPayment.expires_at}
                />
              )}

              {!activePayment && loginPayment && !token && (
                <div className="rounded-lg border border-line p-4 space-y-2 bg-surface-2/50">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-ink text-lg">₹{loginPayment.expectedAmount ?? 'N/A'}</span>
                    <StatusBadge status={loginPayment.paymentStatus || 'pending'} />
                  </div>
                  {loginPayment.selectedPlan && (
                    <p className="text-sm text-ink-muted">Plan: ₹{loginPayment.selectedPlan}</p>
                  )}
                  {loginPayment.submittedAt && (
                    <p className="text-sm text-ink-muted">Submitted: {new Date(loginPayment.submittedAt).toLocaleString()}</p>
                  )}
                  {loginPayment.rejectionReason && (
                    <p className="text-sm text-error-600 dark:text-error-400">Reason: {loginPayment.rejectionReason}</p>
                  )}
                </div>
              )}

              {!activePayment && !loginPayment && payments.length === 0 && (
                <div className="text-center py-6">
                  <CheckCircle className="h-9 w-9 text-success-600 mx-auto mb-2" aria-hidden="true" />
                  <p className="text-ink-muted text-sm">No pending payment. If you recently registered, your payment will appear here.</p>
                </div>
              )}

              <div className="border-t border-line pt-4">
                <button onClick={logout} className="btn btn-secondary w-full">
                  <LogOut className="h-4 w-4" aria-hidden="true" /> Logout
                </button>
                <p className="text-center text-xs text-ink-faint mt-3">
                  Need help? Contact support at <span className="font-medium text-ink-muted">support@referralhub.com</span>
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <Modal isOpen={!!selected} onClose={() => setSelected(null)} title="Payment Screenshot" size="lg">
        {selected && (
          <PaymentScreenshot
            endpoint={`/payments/${selected.id}/screenshot`}
            alt="Payment screenshot"
            className="w-full rounded-lg border border-line"
          />
        )}
      </Modal>
    </div>
  );
}
