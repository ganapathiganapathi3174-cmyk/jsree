import { verifyToken } from '../utils/helpers.js';
import { supabase } from '../db/supabase.js';

export const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token required',
        code: 'TOKEN_REQUIRED'
      });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token',
        code: 'TOKEN_INVALID'
      });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('id, full_name, email, mobile, role, status, referral_code, current_plan')
      .eq('id', decoded.userId)
      .single();

    if (error || !user) {
      return res.status(401).json({
        success: false,
        message: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Authentication error',
      code: 'AUTH_ERROR'
    });
  }
};

export const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Admin access required',
      code: 'ADMIN_REQUIRED'
    });
  }
  next();
};

// Blocks access to normal user dashboard/wallet/referral/feature endpoints
// until the user's initial registration payment is APPROVED (status === 'active').
// Enforced server-side — never rely on frontend route guards alone.
export const requireActiveUser = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Access token required',
      code: 'TOKEN_REQUIRED'
    });
  }
  if (req.user.role === 'admin') {
    return next();
  }
  if (req.user.status === 'active') {
    return next();
  }
  if (req.user.status === 'pending') {
    return res.status(403).json({
      success: false,
      message: 'Your registration payment has not been approved yet. Payment verification is in progress.',
      code: 'PAYMENT_NOT_APPROVED',
      data: { accountStatus: 'pending' }
    });
  }
  return res.status(403).json({
    success: false,
    message: 'Account is not active. Please contact support.',
    code: 'ACCOUNT_NOT_ACTIVE',
    data: { accountStatus: req.user.status }
  });
};

export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      req.user = null;
      return next();
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      req.user = null;
      return next();
    }

    const { data: user } = await supabase
      .from('users')
      .select('id, full_name, email, mobile, role, status, referral_code, current_plan')
      .eq('id', decoded.userId)
      .single();

    req.user = user || null;
    next();
  } catch (error) {
    req.user = null;
    next();
  }
};

export const extractUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      req.user = null;
      return next();
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      req.user = null;
      return next();
    }

    const { data: user } = await supabase
      .from('users')
      .select('id, full_name, email, mobile, role, status, referral_code, current_plan')
      .eq('id', decoded.userId)
      .single();

    req.user = user || null;
    next();
  } catch (error) {
    req.user = null;
    next();
  }
};
