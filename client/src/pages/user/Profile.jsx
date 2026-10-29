import { useState, useEffect, useRef } from 'react';
import { User, Mail, Phone, Hash, CreditCard, Calendar, Camera, X, Upload, Pencil, Save, Loader } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import { PLAN_MAP } from '../../utils/constants';
import StatusBadge from '../../components/StatusBadge';
import LoadingSpinner from '../../components/LoadingSpinner';
import Avatar from '../../components/Avatar';
import PageHeader from '../../components/PageHeader';

const ACCEPTED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_SIZE = 2 * 1024 * 1024;

export default function Profile() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [preview, setPreview] = useState(null);
  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editName, setEditName] = useState('');
  const [editMobile, setEditMobile] = useState('');
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
  if (!profile) return <div className="callout callout-error" role="alert">Failed to load profile</div>;

  const startEdit = () => {
    setEditName(profile.full_name || '');
    setEditMobile(profile.mobile || '');
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!editName.trim()) { toast.error('Name is required'); return; }
    if (!/^[0-9+]{10,15}$/.test(editMobile.trim())) { toast.error('Invalid mobile number'); return; }
    setSavingEdit(true);
    try {
      const { data } = await api.put('/users/profile', { name: editName.trim(), mobile: editMobile.trim() });
      toast.success('Profile updated');
      setEditing(false);
      setProfile(data.data);
      localStorage.setItem('user', JSON.stringify(data.data));
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update profile');
    } finally { setSavingEdit(false); }
  };

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
      <PageHeader title="My Profile" description="Manage your personal information" />
      <div className="card">
        <div className="flex items-center gap-5 mb-6 pb-5 border-b border-line">
          <div className="relative shrink-0">
            <div className="w-24 h-24 rounded-full overflow-hidden flex items-center justify-center bg-gradient-to-br from-primary-600 to-primary-700 ring-4 ring-line">
              {displayAvatar ? (
                <img src={displayAvatar} alt={profile.full_name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <Avatar user={profile} size={96} />
              )}
            </div>
            <button
              onClick={() => fileRef.current?.click()}
              className="btn btn-primary btn-icon btn-sm absolute bottom-0 right-0 shadow-md"
              title="Change photo"
              aria-label="Change photo"
            >
              <Camera className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-ink truncate">{profile.full_name}</h2>
            <div className="mt-1"><StatusBadge status={profile.status} /></div>
            <p className="text-sm text-ink-muted mt-1 truncate">{profile.email}</p>
          </div>
        </div>

        {preview && (
          <div className="mb-6 rounded-lg border border-primary-500/25 bg-primary-500/10 p-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full overflow-hidden shrink-0">
                <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink mb-2">Preview your new profile picture</p>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={upload} disabled={uploading} className="btn btn-primary btn-sm">
                    <Upload className="h-4 w-4" aria-hidden="true" /> {uploading ? 'Uploading...' : 'Save Photo'}
                  </button>
                  <button onClick={() => { setPreview(null); fileRef.current.value = ''; }} disabled={uploading} className="btn btn-secondary btn-sm">
                    <X className="h-4 w-4" aria-hidden="true" /> Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 mb-6">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp"
            className="hidden"
            onChange={handleFile}
          />
          <button onClick={() => fileRef.current?.click()} className="btn btn-secondary btn-sm" disabled={uploading}>
            <Camera className="h-4 w-4" aria-hidden="true" /> Change Photo
          </button>
          {profile.avatar_url && (
            <button onClick={remove} disabled={removing} className="btn btn-ghost btn-sm text-error-600 dark:text-error-400">
              <X className="h-4 w-4" aria-hidden="true" /> {removing ? 'Removing...' : 'Remove Photo'}
            </button>
          )}
        </div>

        <div className="flex items-center justify-between mb-4">
          <h3 className="page-subheading">Account Details</h3>
          {!editing ? (
            <button onClick={startEdit} className="btn btn-secondary btn-sm">
              <Pencil className="h-4 w-4" aria-hidden="true" /> Edit
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={saveEdit} disabled={savingEdit} className="btn btn-primary btn-sm">
                {savingEdit ? <Loader className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />} Save
              </button>
              <button onClick={() => setEditing(false)} disabled={savingEdit} className="btn btn-secondary btn-sm">
                <X className="h-4 w-4" aria-hidden="true" /> Cancel
              </button>
            </div>
          )}
        </div>

        <div className="space-y-1">
          {fields.map((f, i) => (
            <div key={i} className="flex items-center gap-3 py-2.5 border-b border-line/70 last:border-0">
              <f.icon className="h-5 w-5 text-ink-faint shrink-0" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-ink-faint">{f.label}</p>
                {editing && (f.label === 'Full Name' || f.label === 'Mobile') ? (
                  f.label === 'Full Name' ? (
                    <input value={editName} onChange={e => setEditName(e.target.value)} className="input-field mt-1.5" placeholder="Full name" aria-label="Full name" />
                  ) : (
                    <input value={editMobile} onChange={e => setEditMobile(e.target.value)} className="input-field mt-1.5" placeholder="Mobile number" aria-label="Mobile number" />
                  )
                ) : (
                  <p className="font-medium text-ink break-words">{f.value}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
