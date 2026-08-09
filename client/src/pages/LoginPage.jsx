import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, LogIn } from 'lucide-react';
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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link to="/" className="text-primary-600 font-bold text-xl">ReferralHub</Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-4">Welcome Back</h1>
          <p className="text-gray-600 mt-1">Sign in to your account</p>
        </div>
        <div className="card">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Email</label>
              <div className="relative"><Mail className="absolute left-3 top-3 h-4 w-4 text-gray-400" /><input className="input-field pl-10" type="email" placeholder="you@example.com" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
            </div>
            <div>
              <label className="label">Password</label>
              <div className="relative"><Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" /><input className="input-field pl-10" type="password" placeholder="Your password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></div>
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
              {loading ? 'Signing in...' : <><LogIn className="h-4 w-4" /> Sign In</>}
            </button>
          </form>
          <p className="text-center text-sm text-gray-600 mt-4">Don't have an account? <Link to="/register" className="text-primary-600 font-medium">Register</Link></p>
          <p className="text-center text-sm text-gray-600 mt-2"><Link to="/admin/login" className="text-gray-500 hover:text-gray-700">Admin Login</Link></p>
        </div>
      </div>
    </div>
  );
}
