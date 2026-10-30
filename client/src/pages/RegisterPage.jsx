import { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { User, Mail, Phone, ArrowRight, ArrowLeft, CheckCircle, Shield } from 'lucide-react';
import PasswordInput from '../components/PasswordInput';
import ThemeToggle from '../components/ThemeToggle';
import toast from 'react-hot-toast';
import api, { isTimeoutError } from '../utils/api';
import { PLANS, ADMIN_UPI } from '../utils/constants';
import QRPaymentSection from '../components/QRPaymentSection';

const debug = (...args) => {
  if (import.meta.env.DEV) console.log('[register]', ...args);
};

export default function RegisterPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [paymentData, setPaymentData] = useState(null);
  const [serverUpi, setServerUpi] = useState(ADMIN_UPI);
  const [form, setForm] = useState({
    name: '', email: '', mobile: '', password: '', confirmPassword: '',
    referral_code: searchParams.get('ref') || '',
    plan: parseInt(searchParams.get('plan')) || null
  });

  useEffect(() => {
    api.get('/config/public').then(res => {
      if (res.data?.data?.receiver_upi) setServerUpi(res.data.data.receiver_upi);
    }).catch(() => {});
  }, []);

  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  // Human-readable payment rejection messages. Internal verification
  // reason codes are never shown to normal users.
  const friendlyRejectionMessage = (reason) => {
    switch (reason) {
      case 'AMOUNT_MISMATCH':
        return 'The screenshot amount does not match your plan amount. Please pay the exact amount and upload that screenshot.';
      case 'AMOUNT_NOT_DETECTED':
        return 'We could not read the amount from your screenshot. Please upload a clearer, uncropped screenshot of the full payment confirmation.';
      case 'UPI_MISMATCH':
        return 'The screenshot shows a different recipient. Please pay to the UPI ID shown on this screen.';
      case 'RECEIVER_NAME_MISMATCH':
        return 'The screenshot shows a different recipient name. Please pay to the account shown on this screen.';
      case 'RECEIVER_NAME_INCOMPLETE':
        return 'The recipient name in your screenshot is only partially visible. Please upload a screenshot showing the full recipient name.';
      case 'RECEIVER_NAME_NOT_CONFIGURED':
        return 'Your payment is being reviewed by our team because we could not confirm the recipient name.';
      case 'INVALID_PAYMENT_DATE':
        return 'This screenshot is too old or its date could not be read. Please upload the screenshot from your current payment.';
      case 'PAYMENT_DATE_NOT_DETECTED':
        return 'We could not read the payment date from your screenshot. Please upload a screenshot that shows the transaction date.';
      case 'PAYMENT_TIME_NOT_DETECTED':
        return 'We could not read the payment time from your screenshot. Please upload a screenshot that shows the date AND time of the transaction.';
      case 'TRANSACTION_FAILED':
        return 'The screenshot shows a failed or pending transaction. Only completed payments can be verified.';
      case 'MISSING_UTR':
        return 'No transaction ID was found in the screenshot. Please upload the full confirmation screen.';
      case 'LOW_OCR_CONFIDENCE':
        return 'The screenshot was not clear enough to verify. Please upload a sharper, uncropped screenshot.';
      case 'LOW_FIELD_CONFIDENCE':
        return 'We could not read every detail of your payment with enough confidence. Please upload a sharper, uncropped screenshot.';
      case 'DUPLICATE_UTR':
        return 'This payment has already been used. Please complete a fresh payment and upload its screenshot.';
      case 'DEMO_SCREENSHOT':
        return 'Sample or demo screenshots are not accepted. Please upload your real payment confirmation.';
      case 'PAYMENT_EXPIRED':
        return 'This payment request has expired. Please create a new payment request.';
      default:
        return 'Payment could not be verified. Please resubmit a valid screenshot from your current payment.';
    }
  };

  // A verification that produced NO decision (OCR timeout, unreadable image,
  // crashed worker) is INCONCLUSIVE, never an approval and never a rejection.
  // It stays resubmittable, so the user is told to try again.
  const isInconclusive = (verification) =>
    verification?.inconclusive === true ||
    ['OCR_TIMEOUT', 'OCR_FAILED', 'OCR_UNREADABLE'].includes(verification?.reason);

  const validateStep1 = () => {
    if (!form.name || !form.email || !form.mobile || !form.password || !form.confirmPassword) {
      toast.error('All fields are required'); return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      toast.error('Invalid email format'); return false;
    }
    if (form.password.length < 6) {
      toast.error('Password must be at least 6 characters'); return false;
    }
    if (form.password !== form.confirmPassword) {
      toast.error('Passwords do not match'); return false;
    }
    return true;
  };

  const validateStep2 = () => {
    if (!form.plan) { toast.error('Please select a plan'); return false; }
    return true;
  };

  const registeredRef = useRef(false);

  const handleGoToPayment = async () => {
    debug('create-payment:called', { alreadyRegistered: registeredRef.current, step });
    // Re-entrancy guard is `loading`, not `registeredRef`: registration must
    // only run once, but the payment request itself must stay re-runnable so
    // "Create New Payment Request" and Back → Next keep working after a
    // failed or expired payment attempt.
    if (loading) return;
    setLoading(true);
    try {
      if (!registeredRef.current) {
        const regPayload = {
          name: form.name,
          email: form.email,
          mobile: form.mobile,
          password: form.password,
          referralCode: form.referral_code || undefined,
          plan: form.plan,
        };

        debug('create-payment:register-request');
        const regRes = await api.post('/auth/register', regPayload);
        const token = regRes.data.data.token;
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(regRes.data.data.user));
        registeredRef.current = true;
      }

      debug('create-payment:payment-request');
      const payRes = await api.post('/payments', { plan: String(form.plan) });
      setPaymentData(payRes.data.data);
      setStep(3);
      debug('create-payment:done', { paymentId: payRes.data.data?.id });
    } catch (err) {
      const code = err.response?.data?.code;
      if (code === 'EMAIL_EXISTS' || code === 'MOBILE_EXISTS') {
        toast.error('An account with this email/mobile already exists. Please login.');
        navigate('/login');
      } else {
        toast.error(err.response?.data?.message || 'Registration failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (file = null) => {
    // loading is set before the guards so every exit path below — validation,
    // API failure, timeout or exception — lands in `finally` and clears it.
    setLoading(true);
    try {
      if (!file) { toast.error('Please upload payment screenshot'); return; }
      if (!paymentData?.id) { toast.error('Payment request not found. Please go back and try again.'); return; }

      debug('verify:start', { paymentId: paymentData.id, fileName: file.name, size: file.size });
      const fd = new FormData();
      fd.append('screenshot', file);
      const uploadRes = await api.post(`/payments/${paymentData.id}/screenshot`, fd);
      debug('verify:upload-response', { status: uploadRes.status });

      const verification = uploadRes.data.data?.verification;
      if (verification?.status === 'approved') {
        try {
          const profRes = await api.get('/users/profile');
          localStorage.setItem('user', JSON.stringify(profRes.data.data));
        } catch (err) {
          // keep existing localStorage user
        }
        toast.success('Registration and payment approved!');
        navigate('/dashboard');
      } else if (verification?.status === 'rejected') {
        toast.error(friendlyRejectionMessage(verification.reason));
        navigate('/payment-status');
      } else if (verification?.status === 'manual_review') {
        toast('Your payment is being reviewed by our team. We will notify you once it is verified.', { icon: '⏳' });
        navigate('/payment-status');
      } else if (isInconclusive(verification)) {
        // No decision was reached (OCR timeout / unreadable screenshot). The
        // payment is still pending and resubmittable — never a silent success.
        toast.error(verification?.reason === 'OCR_TIMEOUT'
          ? 'Verification took too long to finish. Your payment is still pending — please upload the screenshot again.'
          : 'We could not read your screenshot. Your payment is still pending — please upload a clearer screenshot.');
        navigate('/payment-status');
      } else {
        toast.error('Payment verification could not finish. Your payment is still pending — please upload the screenshot again.');
        navigate('/payment-status');
      }
    } catch (err) {
      const code = err.response?.data?.code;
      if (code === 'PAYMENT_EXPIRED') {
        toast.error('Payment request expired. Please create a new payment request.');
        setPaymentData(null);
      } else if (code === 'OCR_TIMEOUT') {
        toast.error('Verification took too long to finish. Your payment is still pending — please upload the screenshot again.');
      } else if (code === 'REQUEST_TIMEOUT' || code === 'ECONNABORTED' || code === 'ETIMEDOUT' || isTimeoutError(err)) {
        debug('verify:timeout', { paymentId: paymentData?.id });
        toast.error('Verification timed out. The server is taking too long (possibly a cold start). Please try again in a moment.');
      } else if (code === 'DUPLICATE_REQUEST') {
        toast.error('A verification for this screenshot is already in progress. Please wait for the result.');
      } else {
        toast.error(err.response?.data?.message || 'Verification failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const stepLabels = ['Your details', 'Choose a plan', 'Pay securely'];

  return (
    <div className="min-h-screen landing-bg flex items-center justify-center p-4 py-10">
      <div className="fixed top-4 right-4 z-20">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-lg relative z-10">
        {/* Header + stepper */}
        <div className="text-center mb-7">
          <Link to="/" className="inline-flex items-center justify-center gap-2.5 mb-5" aria-label="JSREE home">
            <span className="w-10 h-10 bg-primary-600 rounded-lg flex items-center justify-center">
              <Shield className="h-5 w-5 text-white" aria-hidden="true" />
            </span>
            <span className="text-2xl font-bold tracking-tight text-ink">JSREE</span>
          </Link>
          <h1 className="text-2xl sm:text-3xl font-bold text-ink">Create Account</h1>
          <p className="text-ink-muted mt-1 text-sm">Step {step} of 3 — {stepLabels[step - 1]}</p>
          <div
            className="flex items-center justify-center gap-2 mt-4"
            role="progressbar"
            aria-valuenow={step}
            aria-valuemin={1}
            aria-valuemax={3}
            aria-label="Registration progress"
          >
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  s < step
                    ? 'bg-success-500 w-10'
                    : s === step
                      ? 'bg-primary-500 w-14'
                      : 'bg-line w-8'
                }`}
              />
            ))}
          </div>
        </div>

        <div className="card">
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-base font-semibold text-ink">Personal Information</h2>
              <div>
                <label htmlFor="register-name" className="label required">Full Name</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint pointer-events-none" aria-hidden="true" />
                  <input id="register-name" className="input-field pl-10" placeholder="John Doe" autoComplete="name" value={form.name} onChange={e => set('name', e.target.value)} />
                </div>
              </div>
              <div>
                <label htmlFor="register-email" className="label required">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint pointer-events-none" aria-hidden="true" />
                  <input id="register-email" className="input-field pl-10" type="email" placeholder="john@example.com" autoComplete="email" value={form.email} onChange={e => set('email', e.target.value)} />
                </div>
              </div>
              <div>
                <label htmlFor="register-mobile" className="label required">Mobile</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint pointer-events-none" aria-hidden="true" />
                  <input id="register-mobile" className="input-field pl-10" type="tel" inputMode="numeric" placeholder="9876543210" autoComplete="tel" value={form.mobile} onChange={e => set('mobile', e.target.value)} />
                </div>
              </div>
              <div>
                <label htmlFor="register-password" className="label required">Password</label>
                <PasswordInput id="register-password" placeholder="Min 6 characters" autoComplete="new-password" value={form.password} onChange={e => set('password', e.target.value)} />
              </div>
              <div>
                <label htmlFor="register-confirm-password" className="label required">Confirm Password</label>
                <PasswordInput id="register-confirm-password" placeholder="Re-enter password" autoComplete="new-password" value={form.confirmPassword} onChange={e => set('confirmPassword', e.target.value)} />
              </div>
              <div>
                <label htmlFor="register-referral-code" className="label">Referral Code (optional)</label>
                <input id="register-referral-code" className="input-field uppercase" placeholder="Enter referral code" value={form.referral_code} onChange={e => set('referral_code', e.target.value.toUpperCase())} />
              </div>
              <button onClick={() => { if (validateStep1()) setStep(2); }} className="btn btn-primary w-full">
                Next <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
              <p className="text-center text-sm text-ink-muted">
                Already have an account? <Link to="/login" className="link">Login</Link>
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-base font-semibold text-ink">Select Plan</h2>
              <div className="space-y-2.5" role="group" aria-label="Plans">
                {PLANS.map((p) => {
                  const active = form.plan === p.id;
                  return (
                    <button
                      key={p.id}
                      aria-pressed={active}
                      onClick={() => set('plan', p.id)}
                      className={`w-full px-4 py-3.5 rounded-lg border text-left flex items-center justify-between transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/50 ${
                        active
                          ? 'border-primary-600 bg-primary-500/10'
                          : 'border-line bg-surface hover:bg-surface-2'
                      }`}
                    >
                      <span>
                        <span className={`font-semibold ${active ? 'text-primary-700 dark:text-primary-300' : 'text-ink'}`}>{p.name}</span>
                        <span className="text-ink-muted ml-2">— {p.label}</span>
                      </span>
                      <CheckCircle
                        className={`h-5 w-5 ${active ? 'text-primary-600 dark:text-primary-400' : 'text-line'}`}
                        aria-hidden="true"
                      />
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setStep(1)} className="btn btn-secondary flex-1">
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
                </button>
                <button
                  onClick={() => { if (validateStep2()) handleGoToPayment(); }}
                  className="btn btn-primary flex-1"
                  disabled={loading}
                >
                  {loading ? 'Setting up...' : <><span>Next</span> <ArrowRight className="h-4 w-4" aria-hidden="true" /></>}
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-ink">Complete Payment</h2>
                {form.plan && <span className="badge badge-info">Plan: ₹{form.plan}</span>}
              </div>
              {paymentData ? (
                <QRPaymentSection
                  amount={form.plan}
                  upiId={serverUpi}
                  verifyLabel="Verify Payment & Continue"
                  verifySubmitting={loading}
                  onVerify={handleSubmit}
                  onRecreate={handleGoToPayment}
                  expiresAt={paymentData?.expires_at || null}
                />
              ) : (
                <div className="py-10 text-center" role="status">
                  <div className="h-8 w-8 mx-auto mb-3 animate-spin rounded-full border-2 border-line border-t-primary-600" />
                  <p className="text-ink-muted text-sm">Setting up payment request...</p>
                </div>
              )}
              <button onClick={() => setStep(2)} className="btn btn-secondary w-full" disabled={loading}>
                <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
