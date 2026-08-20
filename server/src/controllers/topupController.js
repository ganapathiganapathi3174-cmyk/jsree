import * as topupService from '../services/topupService.js';
import { supabase } from '../db/supabase.js';

export async function getTopups(req, res) {
  try {
    const result = await topupService.getTopupsForUser(req.user.id);
    const topups = [...(result.sent || []), ...(result.received || [])];
    topups.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const summary = topupService.computeTopupSummary(result.received || []);
    const { data: me } = await supabase.from('users').select('referred_by').eq('id', req.user.id).single();
    let sponsorName = null;
    if (me?.referred_by) {
      const { data: sponsor } = await supabase.from('users').select('full_name').eq('id', me.referred_by).single();
      sponsorName = sponsor?.full_name || null;
    }
    summary.sponsorId = me?.referred_by || null;
    summary.sponsorName = sponsorName;

    res.json({ success: true, data: topups, summary });
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
    res.json({ success: true, message: result.message, data: { topupId: result.topupId, credited: result.credited || false } });
  } catch (error) {
    const status = error.code === 'TOPUP_NOT_FOUND' ? 404
      : error.code === 'UNAUTHORIZED' ? 403
      : error.code === 'TOPUP_NOT_SUBMITTABLE' ? 400
      : error.code === 'OCR_FAILED' || error.code === 'OCR_UNREADABLE' ? 400
      : 500;
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

// Direct sponsor top-up. Multipart body: amount (required), screenshot
// (optional now to create a pending record, or required to verify in one go).
// receiverId is optional — when omitted the user's own sponsor is used.
export async function directTopup(req, res) {
  try {
    const result = await topupService.createDirectTopup({
      senderId: req.user.id,
      amount: Number(req.body.amount),
      receiverId: req.body.receiverId || null,
      file: req.file || null,
    });
    res.status(result.created ? 201 : 200).json({ success: true, message: result.message, data: { topupId: result.topupId, credited: result.credited || false } });
  } catch (error) {
    const status = error.code === 'INVALID_AMOUNT' || error.code === 'NO_SPONSOR' || error.code === 'RECEIVER_INACTIVE' || error.code === 'TOPUP_NOT_SUBMITTABLE'
      ? 400
      : error.code === 'RECEIVER_NOT_FOUND' || error.code === 'TOPUP_NOT_FOUND'
        ? 404
        : error.code === 'UNAUTHORIZED'
          ? 403
          : error.code === 'OCR_FAILED' || error.code === 'OCR_UNREADABLE'
            ? 400
            : 500;
    res.status(status).json({ success: false, message: error.message || 'Failed to process top-up', code: error.code || 'DIRECT_TOPUP_FAILED' });
  }
}
