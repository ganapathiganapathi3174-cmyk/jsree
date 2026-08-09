import * as authService from '../services/authService.js';

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress || 'unknown';
}

export async function register(req, res) {
  try {
    const { name, email, mobile, password, referralCode, plan } = req.body;
    const ip = getClientIP(req);
    const ua = req.headers['user-agent'];
    const result = await authService.register({ name, email, mobile, password, referralCode, plan }, ip, ua);
    res.status(201).json({
      success: true,
      data: {
        user: result.user,
        token: result.token
      }
    });
  } catch (error) {
    const status = error.code === 'EMAIL_EXISTS' || error.code === 'MOBILE_EXISTS' ? 409 :
                   error.code === 'INVALID_REFERRAL' || error.code === 'REFERRAL_INACTIVE' ? 400 : 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Registration failed',
      code: error.code || 'REGISTRATION_FAILED'
    });
  }
}

export async function login(req, res) {
  try {
    const { email, password } = req.body;
    const ip = getClientIP(req);
    const ua = req.headers['user-agent'];
    const result = await authService.login(email, password, ip, ua);
    res.json({
      success: true,
      data: {
        user: result.user,
        token: result.token
      }
    });
  } catch (error) {
    const status = error.code === 'INVALID_CREDENTIALS' ? 401 :
                   error.code === 'ACCOUNT_DELETED' ? 403 :
                   error.code === 'ACCOUNT_NOT_ACTIVE' ? 403 :
                   error.code === 'PAYMENT_NOT_APPROVED' ? 403 : 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Login failed',
      code: error.code || 'LOGIN_FAILED',
      ...(error.data ? { data: error.data } : {})
    });
  }
}

export async function adminLogin(req, res) {
  try {
    const { email, password } = req.body;
    const ip = getClientIP(req);
    const ua = req.headers['user-agent'];
    const result = await authService.adminLogin(email, password, ip, ua);
    res.json({
      success: true,
      data: {
        user: result.user,
        token: result.token
      }
    });
  } catch (error) {
    const status = error.code === 'INVALID_CREDENTIALS' ? 401 :
                   error.code === 'ADMIN_NOT_CONFIGURED' ? 500 : 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Admin login failed',
      code: error.code || 'ADMIN_LOGIN_FAILED'
    });
  }
}

export async function logout(req, res) {
  try {
    const userId = req.user?.id || null;
    await authService.logout(userId);
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Logout failed',
      code: 'LOGOUT_FAILED'
    });
  }
}

export async function getProfile(req, res) {
  try {
    const user = await authService.getProfile(req.user.id);
    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      message: error.message || 'User not found',
      code: error.code || 'USER_NOT_FOUND'
    });
  }
}

export async function changePassword(req, res) {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Both old and new passwords are required',
        code: 'VALIDATION_ERROR'
      });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters',
        code: 'VALIDATION_ERROR'
      });
    }
    const result = await authService.changePassword(req.user.id, oldPassword, newPassword);
    res.json({
      success: true,
      message: result.message
    });
  } catch (error) {
    const status = error.code === 'INVALID_PASSWORD' ? 400 : 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Password change failed',
      code: error.code || 'PASSWORD_CHANGE_FAILED'
    });
  }
}
