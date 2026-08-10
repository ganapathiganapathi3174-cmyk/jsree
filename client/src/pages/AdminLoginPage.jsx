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
        <Link to="/" className="flex items-center gap-2 text-indigo-200 hover:text-white mb-8"><ArrowLeft className="h-4 w-4" /> Back to Home</Link>
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-2xl"><Shield className="h-8 w-8 text-white" /></div>
          <h1 className="text-2xl font-bold text-white">JSREE Admin Portal</h1>
          <p className="text-indigo-200/70 mt-1">Secure admin access</p>
        </div>
        <div className="card bg-gray-900/80 backdrop-blur-xl rounded-xl p-8 border border-white/10 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label text-gray-300">Email</label>
              <div className="relative"><Mail className="absolute left-3 top-3 h-4 w-4 text-gray-500" /><input className="input-field pl-10 bg-gray-800 border-gray-700 text-white placeholder-gray-500 focus:ring-primary-500" type="email" placeholder="admin@example.com" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
            </div>
            <div>
              <label className="label text-gray-300">Password</label>
              <div className="relative"><Lock className="absolute left-3 top-3 h-4 w-4 text-gray-500" /><input className="input-field pl-10 bg-gray-800 border-gray-700 text-white placeholder-gray-500 focus:ring-primary-500" type="password" placeholder="Admin password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></div>
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full">{loading ? 'Signing in...' : 'Admin Sign In'}</button>
          </form>
        </div>
      </div>
    </div>
  );
}
