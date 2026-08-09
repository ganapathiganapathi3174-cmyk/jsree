import * as topupService from '../services/topupService.js';
import { supabase } from '../db/supabase.js';

export async function getTopups(req, res) {
  try {
    const result = await topupService.getTopupsForUser(req.user.id);
    const topups = [...(result.sent || []), ...(result.received || [])];
    topups.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json({ success: true, data: topups });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch topups', code: error.code || 'FETCH_FAILED' });
  }
}

export async function getTopupDetails(req, res) {
  try {
    const topup = await topupService.getTopupDetails(req.params.topupId);
    if (topup.sender_id !== req.user.id && topup.receiver_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
    res.json({ success: true, data: topup });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message || 'Topup not found', code: error.code || 'TOPUP_NOT_FOUND' });
  }
}

export async function submitProof(req, res) {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'Proof file is required', code: 'NO_FILE' });
    const result = await topupService.submitTopupProof(req.params.topupId, req.file, req.user.id);
    res.json({ success: true, message: result.message });
  } catch (error) {
    const status = error.code === 'TOPUP_NOT_FOUND' ? 404 : error.code === 'UNAUTHORIZED' ? 403 : error.code === 'TOPUP_NOT_SUBMITTABLE' ? 400 : 500;
    res.status(status).json({ success: false, message: error.message || 'Failed to submit proof', code: error.code || 'SUBMIT_FAILED' });
  }
}

export async function claimTopup(req, res) {
  try {
    const { receiverId } = req.body;
    const senderId = req.user.id;
    if (!receiverId) return res.status(400).json({ success: false, message: 'Receiver ID is required', code: 'VALIDATION_ERROR' });

    const { data: receiver } = await supabase.from('users').select('id, full_name, status').eq('id', receiverId).single();
    if (!receiver) return res.status(404).json({ success: false, message: 'Receiver not found', code: 'RECEIVER_NOT_FOUND' });

    const { data: sender } = await supabase.from('users').select('current_plan').eq('id', senderId).single();
    const topup = await topupService.createTopup(senderId, receiverId, sender?.current_plan || 120);
    res.status(201).json({ success: true, data: topup });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to create topup', code: error.code || 'TOPUP_CREATE_FAILED' });
  }
}
