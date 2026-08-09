import { useState, useEffect } from 'react';
import { User, Mail, Phone, Hash, CreditCard, Calendar } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import { PLAN_MAP } from '../../utils/constants';
import StatusBadge from '../../components/StatusBadge';
import LoadingSpinner from '../../components/LoadingSpinner';

export default function Profile() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/users/profile').then(r => setProfile(r.data.data)).catch(() => toast.error('Failed to load profile')).finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner fullPage />;
  if (!profile) return <div className="p-6 text-center text-gray-500">Failed to load profile</div>;

  const fields = [
    { icon: User, label: 'Full Name', value: profile.full_name },
    { icon: Mail, label: 'Email', value: profile.email },
    { icon: Phone, label: 'Mobile', value: profile.mobile },
    { icon: Hash, label: 'User ID', value: profile.id?.slice(0, 8) },
    { icon: CreditCard, label: 'Current Plan', value: PLAN_MAP[profile.current_plan]?.label || 'Not set' },
    { icon: Calendar, label: 'Member Since', value: new Date(profile.created_at).toLocaleDateString() },
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>
      <div className="card">
        <div className="flex items-center gap-4 mb-6 pb-4 border-b">
          <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center"><User className="h-8 w-8 text-primary-600" /></div>
          <div><h2 className="text-xl font-bold">{profile.full_name}</h2><div className="mt-1"><StatusBadge status={profile.status} /></div></div>
        </div>
        <div className="space-y-4">
          {fields.map((f, i) => (
            <div key={i} className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
              <f.icon className="h-5 w-5 text-gray-400 flex-shrink-0" />
              <div className="flex-1"><p className="text-sm text-gray-500">{f.label}</p><p className="font-medium text-gray-900">{f.value}</p></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
