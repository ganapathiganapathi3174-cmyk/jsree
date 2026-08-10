import * as authService from '../services/authService.js';
import { supabase } from '../db/supabase.js';
import { generateUniqueFilename } from '../utils/helpers.js';
import { logAction } from '../services/auditService.js';

const AVATAR_BUCKET = 'avatars';
const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2MB

function isValidAvatarMime(mime) {
  return ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(mime);
}

function getAvatarObjectPath(publicUrl) {
  if (!publicUrl) return null;
  const marker = `/storage/v1/object/public/${AVATAR_BUCKET}/`;
  const idx = publicUrl.indexOf(marker);
  return idx === -1 ? null : publicUrl.slice(idx + marker.length);
}

export async function getProfile(req, res) {
  try {
    const user = await authService.getProfile(req.user.id);
    res.json({ success: true, data: user });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message || 'User not found', code: error.code || 'USER_NOT_FOUND' });
  }
}

export async function updateProfile(req, res) {
  try {
    const { name, mobile } = req.body;
    const updates = {};
    if (name) {
      if (name.trim().length < 2 || name.trim().length > 100) return res.status(400).json({ success: false, message: 'Name must be 2-100 characters', code: 'VALIDATION_ERROR' });
      updates.full_name = name.trim();
    }
    if (mobile) {
      if (!/^[0-9+]{10,15}$/.test(mobile)) return res.status(400).json({ success: false, message: 'Invalid mobile number', code: 'VALIDATION_ERROR' });
      const { data: existingMobile } = await supabase.from('users').select('id').eq('mobile', mobile).neq('id', req.user.id).single();
      if (existingMobile) return res.status(409).json({ success: false, message: 'Mobile number already in use', code: 'MOBILE_EXISTS' });
      updates.mobile = mobile.trim();
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ success: false, message: 'No valid fields to update', code: 'NO_UPDATES' });

    const { data: user, error } = await supabase.from('users').update(updates).eq('id', req.user.id)
      .select('id, full_name, email, mobile, role, status, referral_code, current_plan, avatar_url, created_at').single();
    if (error) throw { message: 'Failed to update profile', code: 'UPDATE_FAILED' };
    res.json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Update failed', code: error.code || 'UPDATE_FAILED' });
  }
}

export async function getDashboard(req, res) {
  try {
    const userId = req.user.id;

    const { data: user } = await supabase.from('users')
      .select('id, full_name, email, mobile, current_plan, status, referral_code, avatar_url, created_at')
      .eq('id', userId).single();

    const { data: referrals } = await supabase.from('users')
      .select('id, full_name, email, status, created_at')
      .eq('referred_by', userId);

    const { data: topups } = await supabase.from('topups')
      .select('id, amount, status, sender_id, receiver_id, created_at, completed_at')
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
      .order('created_at', { ascending: false });

    const activeReferrals = referrals?.filter(r => r.status === 'active') || [];
    const inactiveReferrals = referrals?.filter(r => r.status !== 'active') || [];
    const receivedTopups = topups?.filter(t => t.receiver_id === userId) || [];
    const sentTopups = topups?.filter(t => t.sender_id === userId) || [];
    const totalReceived = receivedTopups.filter(t => t.status === 'completed').reduce((sum, t) => sum + (t.amount || 0), 0);
    const pendingTopups = receivedTopups.filter(t => ['created', 'payment_pending', 'proof_submitted', 'verification_pending'].includes(t.status)).reduce((sum, t) => sum + (t.amount || 0), 0);
    const completedTopups = receivedTopups.filter(t => t.status === 'completed').reduce((sum, t) => sum + (t.amount || 0), 0);

    res.json({
      success: true,
      data: {
        profile: user,
        referralSummary: { code: user?.referral_code, total: referrals?.length || 0, active: activeReferrals.length, inactive: inactiveReferrals.length },
        topupSummary: { totalReceived, pending: pendingTopups, completed: completedTopups }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to load dashboard', code: 'DASHBOARD_FAILED' });
  }
}

export async function uploadAvatar(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded', code: 'NO_FILE' });
    }
    if (!isValidAvatarMime(req.file.mimetype)) {
      return res.status(400).json({ success: false, message: 'Only JPG, PNG, and WEBP images are allowed', code: 'INVALID_FILE_TYPE' });
    }
    if (req.file.size > MAX_AVATAR_SIZE) {
      return res.status(400).json({ success: false, message: 'Image too large. Maximum size is 2MB.', code: 'FILE_TOO_LARGE' });
    }

    const userId = req.user.id;
    const ext = req.file.originalname.split('.').pop()?.toLowerCase() || 'png';
    const allowedExts = ['jpg', 'jpeg', 'png', 'webp'];
    const safeExt = allowedExts.includes(ext) ? ext : 'png';

    const filename = `${userId}-${generateUniqueFilename('avatar.' + safeExt)}`;
    const filePath = `avatars/${userId}/${filename}`;

    const { error: uploadError } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(filePath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
    if (uploadError) throw { message: 'Failed to upload image', code: 'UPLOAD_FAILED', detail: uploadError.message };

    const { data: urlData } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(filePath);
    const avatarUrl = urlData.publicUrl;

    const { error: updateError } = await supabase
      .from('users')
      .update({ avatar_url: avatarUrl })
      .eq('id', userId);
    if (updateError) throw { message: 'Failed to save profile picture', code: 'SAVE_FAILED' };

    await logAction(userId, 'user', 'profile_picture_update', userId, 'user', {});
    res.json({ success: true, data: { avatar_url: avatarUrl } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Upload failed', code: error.code || 'UPLOAD_FAILED' });
  }
}

export async function removeAvatar(req, res) {
  try {
    const userId = req.user.id;

    const { data: user } = await supabase
      .from('users')
      .select('avatar_url')
      .eq('id', userId)
      .single();

    const objectPath = user?.avatar_url ? getAvatarObjectPath(user.avatar_url) : null;
    if (objectPath) {
      const { error: removeError } = await supabase.storage.from(AVATAR_BUCKET).remove([objectPath]);
      if (removeError) throw { message: 'Failed to remove image', code: 'REMOVE_FAILED', detail: removeError.message };
    }

    const { error: updateError } = await supabase
      .from('users')
      .update({ avatar_url: null })
      .eq('id', userId);
    if (updateError) throw { message: 'Failed to remove profile picture', code: 'SAVE_FAILED' };

    await logAction(userId, 'user', 'profile_picture_remove', userId, 'user', {});
    res.json({ success: true, data: { avatar_url: null } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Remove failed', code: error.code || 'REMOVE_FAILED' });
  }
}
