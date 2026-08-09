import * as authService from '../services/authService.js';
import { supabase } from '../db/supabase.js';

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
      .select('id, full_name, email, mobile, role, status, referral_code, current_plan, created_at').single();
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
      .select('id, full_name, email, mobile, current_plan, status, referral_code, created_at')
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
