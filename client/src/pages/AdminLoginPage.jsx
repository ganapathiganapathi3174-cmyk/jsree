import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Shield, ArrowLeft } from 'lucide-react';
import PasswordInput from '../components/PasswordInput';
import toast from 'react-hot-toast';
import api from '../utils/api';

export default function AdminLoginPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.email || !form.password) { toast.error('All fields required'); return; }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/admin-login', form);
      localStorage.setItem('token', data.data.token);
      localStorage.setItem('user', JSON.stringify(data.data.user));
      toast.success('Admin login successful!');
      navigate('/admin');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Login failed');
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen landing-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md relative z-10">
        <Link to="/" className="inline-flex items-center gap-2 text-ink-muted hover:text-ink mb-8 text-sm font-medium">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to Home
        </Link>

        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-primary-700 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Shield className="h-7 w-7 text-white" aria-hidden="true" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-ink">JSREE Admin Portal</h1>
          <p className="text-ink-muted mt-1 text-sm">Secure admin access</p>
        </div>

        <div className="card">
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="admin-login-email" className="label">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint pointer-events-none" aria-hidden="true" />
                <input
                  id="admin-login-email"
                  className="input-field pl-10"
                  type="email"
                  placeholder="Enter your admin email"
                  autoComplete="username"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label htmlFor="admin-login-password" className="label">Password</label>
              <PasswordInput
                id="admin-login-password"
                placeholder="Admin password"
                autoComplete="current-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
            <button type="submit" disabled={loading} className="btn btn-primary w-full">
              {loading ? 'Signing in...' : 'Admin Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
