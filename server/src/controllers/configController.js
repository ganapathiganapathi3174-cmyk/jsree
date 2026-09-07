import * as configService from '../services/configService.js';

export async function getPublicConfig(req, res) {
  try {
    const config = await configService.getPublicConfig();
    res.json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch config',
      code: error.code || 'CONFIG_FETCH_FAILED',
    });
  }
}

export async function getFullConfig(req, res) {
  try {
    const config = await configService.getPaymentConfig();
    res.json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch config',
      code: error.code || 'CONFIG_FETCH_FAILED',
    });
  }
}

export async function updateConfig(req, res) {
  try {
    const updates = req.body;
    if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No configuration updates provided',
        code: 'NO_UPDATES',
      });
    }
    const config = await configService.updatePaymentConfig(updates, req.user.id);
    res.json({ success: true, data: config });
  } catch (error) {
    const status = (error.code === 'INVALID_CONFIG_KEY' || error.code === 'INVALID_CONFIG_VALUE') ? 400 : 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Failed to update config',
      code: error.code || 'CONFIG_UPDATE_FAILED',
    });
  }
}
