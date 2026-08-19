import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, Shield, ArrowLeft } from 'lucide-react';
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
    <div className="min-h-screen bg-transparent flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Link to="/" className="inline-flex items-center gap-2 text-gray-500 hover:text-gray-700 mb-8 text-sm font-medium"><ArrowLeft className="h-4 w-4" /> Back to Home</Link>
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-primary-600 to-primary-700 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm"><Shield className="h-8 w-8 text-white" /></div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">JSREE Admin Portal</h1>
          <p className="text-gray-500 mt-1">Secure admin access</p>
        </div>
        <div className="card p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Email</label>
              <div className="relative"><Mail className="absolute left-3 top-3 h-4 w-4 text-gray-400" /><input className="input-field pl-10" type="email" placeholder="admin@example.com" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
            </div>
            <div>
              <label className="label">Password</label>
              <div className="relative"><Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" /><input className="input-field pl-10" type="password" placeholder="Admin password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></div>
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full">{loading ? 'Signing in...' : 'Admin Sign In'}</button>
          </form>
        </div>
      </div>
    </div>
  );
}