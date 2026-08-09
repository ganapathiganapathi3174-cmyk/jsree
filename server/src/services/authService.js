import { supabase } from '../db/supabase.js';
import { hashPassword, comparePassword, generateToken, generateReferralCode } from '../utils/helpers.js';
import { logAction } from './auditService.js';
import ipLogService from './ipLogService.js';
import suspiciousActivityService from './suspiciousActivityService.js';

export async function register(userData, ipAddress = null, userAgent = null) {
  const { name, email, mobile, password, referralCode, plan } = userData;

  const { data: existingUser } = await supabase
    .from('users')
    .select('id')
    .eq('email', email.toLowerCase())
    .single();

  if (existingUser) {
    throw { message: 'Email already registered', code: 'EMAIL_EXISTS' };
  }

  const { data: existingMobile } = await supabase
    .from('users')
    .select('id')
    .eq('mobile', mobile)
    .single();

  if (existingMobile) {
    throw { message: 'Mobile number already registered', code: 'MOBILE_EXISTS' };
  }

  let referredBy = null;
  let referrerUser = null;
  if (referralCode) {
    const { data: referrer } = await supabase
      .from('users')
      .select('id, status, referral_code')
      .eq('referral_code', referralCode.toUpperCase())
      .single();

    if (!referrer) {
      throw { message: 'Invalid referral code', code: 'INVALID_REFERRAL' };
    }

    if (referrer.status === 'inactive' || referrer.status === 'deleted') {
      throw { message: 'Referral code is no longer active', code: 'REFERRAL_INACTIVE' };
    }

    referredBy = referrer.id;
    referrerUser = referrer;
  }

  let myReferralCode;
  let isUnique = false;
  while (!isUnique) {
    myReferralCode = generateReferralCode();
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('referral_code', myReferralCode)
      .single();
    if (!existing) isUnique = true;
  }

  const hashedPassword = await hashPassword(password);
  const planInt = parseInt(plan);

  const { data: user, error } = await supabase
    .from('users')
    .insert({
      full_name: name.trim(),
      email: email.toLowerCase().trim(),
      mobile: mobile.trim(),
      password_hash: hashedPassword,
      referral_code: myReferralCode,
      referred_by: referredBy,
      current_plan: planInt,
      status: 'pending',
      role: 'user'
    })
    .select('id, full_name, email, mobile, referral_code, current_plan, status, role')
    .single();

  if (error) {
    throw { message: 'Registration failed', code: 'REGISTRATION_FAILED' };
  }

  await logAction(user.id, 'user', 'register', user.id, 'user', {
    plan: planInt,
    referredBy: referredBy || null,
    referralCode: referralCode || null
  });

  if (ipAddress) {
    try {
      await ipLogService.logEvent(user.id, ipAddress, userAgent, 'register', { plan: planInt });
      await suspiciousActivityService.checkMultipleAccountsSameIP(ipAddress);
      if (referredBy) {
        await suspiciousActivityService.checkBulkReferrals(referredBy);
      }
    } catch (e) { /* non-blocking */ }
  }

  const token = generateToken({ userId: user.id, role: user.role });

  return { user, token };
}

export async function login(email, password, ipAddress = null, userAgent = null) {
  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .single();

  if (error || !user) {
    throw { message: 'Invalid email or password', code: 'INVALID_CREDENTIALS' };
  }

  if (user.status === 'deleted') {
    throw { message: 'Account has been deleted', code: 'ACCOUNT_DELETED' };
  }

  if (user.status === 'inactive' || user.status === 'suspended') {
    throw { message: 'Account is not active. Please contact support.', code: 'ACCOUNT_NOT_ACTIVE' };
  }

  const validPassword = await comparePassword(password, user.password_hash);
  if (!validPassword) {
    throw { message: 'Invalid email or password', code: 'INVALID_CREDENTIALS' };
  }

  // A user whose initial registration payment is pending / processing / rejected
  // must NOT receive a normal authenticated dashboard session. Only the payment
  // status endpoints remain reachable via a token obtained at registration.
  if (user.status === 'pending') {
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('id, status, selected_plan, expected_amount, rejection_reason, submitted_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const paymentStatus = paymentError || !payment ? null : payment.status;
    const rejected = paymentStatus === 'rejected';

    throw {
      message: rejected
        ? 'Your payment was not approved. Please contact support.'
        : 'Your payment is being verified. Access will be granted once your payment is approved.',
      code: 'PAYMENT_NOT_APPROVED',
      data: {
        accountStatus: 'pending',
        paymentStatus,
        paymentId: payment?.id || null,
        selectedPlan: payment?.selected_plan || null,
        expectedAmount: payment?.expected_amount || null,
        submittedAt: payment?.submitted_at || null,
        rejectionReason: payment?.rejection_reason || null
      }
    };
  }

  const token = generateToken({ userId: user.id, role: user.role });

  const { password_hash, ...safeUser } = user;

  await logAction(user.id, 'user', 'login', user.id, 'user', {});

  if (ipAddress) {
    try {
      await ipLogService.logEvent(user.id, ipAddress, userAgent, 'login', {});
    } catch (e) { /* non-blocking */ }
  }

  return { user: safeUser, token };
}

export async function adminLogin(email, password, ipAddress = null, userAgent = null) {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;

  if (!adminEmail || !adminPasswordHash) {
    throw { message: 'Admin credentials not configured', code: 'ADMIN_NOT_CONFIGURED' };
  }

  if (email.toLowerCase().trim() !== adminEmail.toLowerCase()) {
    throw { message: 'Invalid admin credentials', code: 'INVALID_CREDENTIALS' };
  }

  const validPassword = await comparePassword(password, adminPasswordHash);
  if (!validPassword) {
    throw { message: 'Invalid admin credentials', code: 'INVALID_CREDENTIALS' };
  }

  let { data: adminUser } = await supabase
    .from('users')
    .select('id, full_name, email, role, status')
    .eq('email', adminEmail.toLowerCase())
    .eq('role', 'admin')
    .single();

  if (!adminUser) {
    const { data: newAdmin } = await supabase
      .from('users')
      .insert({
        full_name: 'Admin',
        email: adminEmail.toLowerCase(),
        mobile: '0000000000',
        password_hash: adminPasswordHash,
        role: 'admin',
        status: 'active',
        referral_code: 'ADMIN001'
      })
      .select('id, full_name, email, role, status')
      .single();
    adminUser = newAdmin;
  }

  const token = generateToken({ userId: adminUser.id, role: adminUser.role });

  await logAction(adminUser.id, 'admin', 'admin_login', adminUser.id, 'user', {});

  if (ipAddress) {
    try {
      await ipLogService.logEvent(adminUser.id, ipAddress, userAgent, 'admin_action', {});
    } catch (e) { /* non-blocking */ }
  }

  return { user: adminUser, token };
}

export async function logout(userId) {
  if (userId) {
    await logAction(userId, 'user', 'logout', userId, 'user', {});
  }
  return { message: 'Logged out successfully' };
}

export async function getProfile(userId) {
  const { data: user, error } = await supabase
    .from('users')
    .select('id, full_name, email, mobile, role, status, referral_code, current_plan, created_at')
    .eq('id', userId)
    .single();

  if (error || !user) {
    throw { message: 'User not found', code: 'USER_NOT_FOUND' };
  }

  return user;
}

export async function changePassword(userId, oldPassword, newPassword) {
  const { data: user, error } = await supabase
    .from('users')
    .select('password_hash')
    .eq('id', userId)
    .single();

  if (error || !user) {
    throw { message: 'User not found', code: 'USER_NOT_FOUND' };
  }

  const validPassword = await comparePassword(oldPassword, user.password_hash);
  if (!validPassword) {
    throw { message: 'Current password is incorrect', code: 'INVALID_PASSWORD' };
  }

  const hashedPassword = await hashPassword(newPassword);

  const { error: updateError } = await supabase
    .from('users')
    .update({ password_hash: hashedPassword })
    .eq('id', userId);

  if (updateError) {
    throw { message: 'Failed to change password', code: 'PASSWORD_CHANGE_FAILED' };
  }

  await logAction(userId, 'user', 'change_password', userId, 'user', {});

  return { message: 'Password changed successfully' };
}
