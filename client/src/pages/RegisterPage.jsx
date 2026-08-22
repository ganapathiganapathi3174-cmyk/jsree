import { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { User, Mail, Phone, ArrowRight, ArrowLeft, CreditCard, CheckCircle, Shield } from 'lucide-react';
import PasswordInput from '../components/PasswordInput';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { PLANS, ADMIN_UPI } from '../utils/constants';
import QRPaymentSection from '../components/QRPaymentSection';

export default function RegisterPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: '', email: '', mobile: '', password: '', confirmPassword: '',
    referral_code: searchParams.get('ref') || '',
    plan: parseInt(searchParams.get('plan')) || null
  });

  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

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

  const handleSubmit = async (file = null) => {
    if (!file) { toast.error('Please upload payment screenshot'); return; }
    setLoading(true);
    try {
      const regPayload = {
        name: form.name,
        email: form.email,
        mobile: form.mobile,
        password: form.password,
        referralCode: form.referral_code || undefined,
        plan: form.plan,
      };

      const regRes = await api.post('/auth/register', regPayload);
      const token = regRes.data.data.token;
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(regRes.data.data.user));

      const payRes = await api.post('/payments', { plan: String(form.plan) });
      const paymentId = payRes.data.data.id;

      const fd = new FormData();
      fd.append('screenshot', file);
      const uploadRes = await api.post(`/payments/${paymentId}/screenshot`, fd);

      const verification = uploadRes.data.data?.verification;
      if (verification?.status === 'approved') {
        try {
          const profRes = await api.get('/users/profile');
          localStorage.setItem('user', JSON.stringify(profRes.data.data));
        } catch (err) {
          localStorage.setItem('user', JSON.stringify(regRes.data.data.user));
        }
        toast.success('Registration and payment approved!');
        navigate('/dashboard');
      } else if (verification?.status === 'rejected') {
        toast.success('Registration complete! Payment is pending admin review.');
        navigate('/payment-status');
      } else {
        toast.success('Registration complete! Payment submitted for review.');
        navigate('/payment-status');
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

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
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Create Account</h1>
          <p className="text-gray-500 mt-1">Step {step} of 3</p>
          <div className="flex items-center justify-center gap-2 mt-3">
            {[1, 2, 3].map(s => (
              <div
                key={s}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  s < step
                    ? 'bg-success-500 shadow-glow-sm'
                    : s === step
                      ? 'bg-primary-400 shadow-glow'
                      : 'bg-slate-500/30'
                } ${s === 1 ? 'w-16' : 'w-8'}`}
              />
            ))}
          </div>
        </div>

        <div className="card">
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Personal Information</h2>
              <div>
                <label className="label">Full Name</label>
                <div className="relative"><User className="absolute left-3 top-3 h-4 w-4 text-gray-400" /><input className="input-field pl-10" placeholder="John Doe" value={form.name} onChange={e => set('name', e.target.value)} /></div>
              </div>
              <div>
                <label className="label">Email</label>
                <div className="relative"><Mail className="absolute left-3 top-3 h-4 w-4 text-gray-400" /><input className="input-field pl-10" type="email" placeholder="john@example.com" value={form.email} onChange={e => set('email', e.target.value)} /></div>
              </div>
              <div>
                <label className="label">Mobile</label>
                <div className="relative"><Phone className="absolute left-3 top-3 h-4 w-4 text-gray-400" /><input className="input-field pl-10" placeholder="9876543210" value={form.mobile} onChange={e => set('mobile', e.target.value)} /></div>
              </div>
              <div>
                <label className="label">Password</label>
                <PasswordInput placeholder="Min 6 characters" value={form.password} onChange={e => set('password', e.target.value)} />
              </div>
              <div>
                <label className="label">Confirm Password</label>
                <PasswordInput placeholder="Re-enter password" value={form.confirmPassword} onChange={e => set('confirmPassword', e.target.value)} />
              </div>
              <div>
                <label className="label">Referral Code (optional)</label>
                <input className="input-field uppercase" placeholder="Enter referral code" value={form.referral_code} onChange={e => set('referral_code', e.target.value.toUpperCase())} />
              </div>
              <button onClick={() => { if (validateStep1()) setStep(2); }} className="btn-primary w-full">Next <ArrowRight className="h-4 w-4" /></button>
              <p className="text-center text-sm text-gray-600">Already have an account? <Link to="/login" className="text-primary-600 font-medium">Login</Link></p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Select Plan</h2>
              <div className="space-y-3">
                {PLANS.map(p => (
                  <button key={p.id} onClick={() => set('plan', p.id)} className={`w-full p-4 rounded-xl border-2 text-left flex items-center justify-between transition-all ${form.plan === p.id ? 'border-primary-600 bg-primary-50' : 'border-gray-200 hover:border-gray-300'}`}>
                    <div><span className="font-semibold text-gray-900">{p.name}</span><span className="text-gray-500 ml-2">- {p.label}</span></div>
                    {form.plan === p.id && <CheckCircle className="h-5 w-5 text-primary-600" />}
                  </button>
                ))}
              </div>
              <div className="flex gap-3 mt-4">
                <button onClick={() => setStep(1)} className="btn-secondary flex-1"><ArrowLeft className="h-4 w-4" /> Back</button>
                <button onClick={() => { if (validateStep2()) setStep(3); }} className="btn-primary flex-1">Next <ArrowRight className="h-4 w-4" /></button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Complete Payment</h2>
              <QRPaymentSection
                amount={form.plan}
                upiId={ADMIN_UPI}
                verifyLabel="Submit Registration"
                verifySubmitting={loading}
                onVerify={handleSubmit}
              />
              <button onClick={() => setStep(2)} className="btn-secondary w-full"><ArrowLeft className="h-4 w-4" /> Back</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}