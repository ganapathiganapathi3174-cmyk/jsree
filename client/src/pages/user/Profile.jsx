import { useState, useEffect, useRef } from 'react';
import { User, Mail, Phone, Hash, CreditCard, Calendar, Camera, X, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import { PLAN_MAP } from '../../utils/constants';
import StatusBadge from '../../components/StatusBadge';
import LoadingSpinner from '../../components/LoadingSpinner';
import Avatar from '../../components/Avatar';

const ACCEPTED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_SIZE = 2 * 1024 * 1024;

export default function Profile() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [preview, setPreview] = useState(null);
  const fileRef = useRef(null);

  const load = () => {
    api.get('/users/profile').then(r => {
      setProfile(r.data.data);
      localStorage.setItem('user', JSON.stringify(r.data.data));
    }).catch(() => toast.error('Failed to load profile')).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) { toast.error('Only JPG, JPEG, PNG, WEBP allowed'); return; }
    if (file.size > MAX_SIZE) { toast.error('Max image size is 2MB'); return; }
    setPreview(file);
  };

  const upload = async () => {
    if (!preview) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('avatar', preview);
      const { data } = await api.put('/users/avatar', fd);
      toast.success('Profile picture updated!');
      setPreview(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Upload failed');
    } finally { setUploading(false); }
  };

  const remove = async () => {
    setRemoving(true);
    try {
      await api.delete('/users/avatar');
      toast.success('Profile picture removed');
      setPreview(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Remove failed');
    } finally { setRemoving(false); }
  };

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

  const previewUrl = preview ? URL.createObjectURL(preview) : null;
  const displayAvatar = previewUrl || profile.avatar_url;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-white">My Profile</h1>
      <div className="card bg-white/90 backdrop-blur-xl rounded-xl border border-white/20 shadow-2xl p-6">
        <div className="flex items-center gap-5 mb-6 pb-5 border-b border-gray-200/70">
          <div className="relative flex-shrink-0">
            <div className="w-24 h-24 rounded-full overflow-hidden flex items-center justify-center bg-gradient-to-br from-indigo-500 to-purple-600 ring-4 ring-white/30 shadow-xl">
              {displayAvatar ? (
                <img src={displayAvatar} alt={profile.full_name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <Avatar user={profile} size={96} />
              )}
            </div>
            <button
              onClick={() => fileRef.current?.click()}
              className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center shadow-lg hover:opacity-90 transition-opacity"
              title="Change photo"
            >
              <Camera className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-gray-900 truncate">{profile.full_name}</h2>
            <div className="mt-1"><StatusBadge status={profile.status} /></div>
            <p className="text-sm text-gray-500 mt-1 truncate">{profile.email}</p>
          </div>
        </div>

        {preview && (
          <div className="mb-6 bg-indigo-50 border border-indigo-200 rounded-xl p-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full overflow-hidden flex-shrink-0">
                <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-800 mb-2">Preview your new profile picture</p>
                <div className="flex gap-2">
                  <button onClick={upload} disabled={uploading} className="btn-primary text-sm flex items-center gap-1.5">
                    <Upload className="h-3.5 w-3.5" /> {uploading ? 'Uploading...' : 'Save Photo'}
                  </button>
                  <button onClick={() => { setPreview(null); fileRef.current.value = ''; }} disabled={uploading} className="btn-secondary text-sm flex items-center gap-1.5">
                    <X className="h-3.5 w-3.5" /> Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 mb-6">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp"
            className="hidden"
            onChange={handleFile}
          />
          <button onClick={() => fileRef.current?.click()} className="btn-secondary text-sm flex items-center gap-1.5" disabled={uploading}>
            <Camera className="h-4 w-4" /> Change Photo
          </button>
          {profile.avatar_url && (
            <button onClick={remove} disabled={removing} className="text-sm text-red-600 hover:text-red-700 font-medium flex items-center gap-1.5">
              <X className="h-4 w-4" /> {removing ? 'Removing...' : 'Remove Photo'}
            </button>
          )}
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
