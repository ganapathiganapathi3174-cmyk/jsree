import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, LogIn, Shield } from 'lucide-react';
import PasswordInput from '../components/PasswordInput';
import toast from 'react-hot-toast';
import api from '../utils/api';

export default function LoginPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.email || !form.password) { toast.error('All fields required'); return; }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', form);
      localStorage.setItem('token', data.data.token);
      localStorage.setItem('user', JSON.stringify(data.data.user));
      toast.success('Login successful!');
      navigate('/dashboard');
    } catch (err) {
      const code = err.response?.data?.code;
      if (code === 'PAYMENT_NOT_APPROVED') {
        navigate('/payment-status', { state: { payment: err.response?.data?.data || null } });
        return;
      }
      toast.error(err.response?.data?.message || 'Login failed');
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen landing-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center justify-center gap-2.5 mb-6" aria-label="JSREE home">
            <span className="w-10 h-10 bg-primary-600 rounded-xl flex items-center justify-center">
              <Shield className="h-5 w-5 text-white" aria-hidden="true" />
            </span>
            <span className="text-2xl font-bold tracking-tight text-ink">JSREE</span>
          </Link>
          <h1 className="text-2xl sm:text-3xl font-bold text-ink">Welcome Back</h1>
          <p className="text-ink-muted mt-1 text-sm">Sign in to your account</p>
        </div>

        <div className="card">
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="login-email" className="label">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint pointer-events-none" aria-hidden="true" />
                <input
                  id="login-email"
                  className="input-field pl-10"
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label htmlFor="login-password" className="label">Password</label>
              <PasswordInput
                id="login-password"
                placeholder="Your password"
                autoComplete="current-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
            <button type="submit" disabled={loading} className="btn btn-primary w-full">
              {loading ? 'Signing in...' : <><LogIn className="h-4 w-4" aria-hidden="true" /> Sign In</>}
            </button>
          </form>

          <div className="mt-5 pt-4 border-t border-line space-y-2 text-center text-sm">
            <p className="text-ink-muted">
              Don't have an account? <Link to="/register" className="link">Register</Link>
            </p>
            <p>
              <Link to="/admin/login" className="text-ink-faint hover:text-ink-muted text-xs font-medium">
                Admin Login
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
