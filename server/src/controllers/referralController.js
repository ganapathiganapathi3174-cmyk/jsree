import * as referralService from '../services/referralService.js';

export async function getMyReferralCode(req, res) {
  try {
    const result = await referralService.getMyReferralCode(req.user.id);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      message: error.message || 'Failed to get referral code',
      code: error.code || 'REFERRAL_FAILED'
    });
  }
}

export async function getMyReferrals(req, res) {
  try {
    const result = await referralService.getMyReferrals(req.user.id);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch referrals',
      code: error.code || 'FETCH_FAILED'
    });
  }
}

export async function validateReferralCode(req, res) {
  try {
    const { code } = req.query;
    const result = await referralService.validateReferralCode(code);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to validate referral code',
      code: 'VALIDATE_FAILED'
    });
  }
}
