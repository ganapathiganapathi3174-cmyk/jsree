import * as adminService from '../services/adminService.js';
import * as paymentService from '../services/paymentService.js';
import * as planService from '../services/planService.js';
import * as chatService from '../services/chatService.js';
import { supabase } from '../db/supabase.js';
import { logAction } from '../services/auditService.js';

export async function getDashboard(req, res) {
  try {
    const stats = await adminService.getDashboardStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch dashboard', code: 'DASHBOARD_FAILED' });
  }
}

export async function getUsers(req, res) {
  try {
    const filters = { status: req.query.status, plan: req.query.plan, search: req.query.search, sortBy: req.query.sortBy, sortOrder: req.query.sortOrder, page: parseInt(req.query.page) || 1, limit: parseInt(req.query.limit) || 20 };
    const result = await adminService.getAllUsers(filters);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch users', code: error.code || 'FETCH_FAILED' });
  }
}

export async function getUserDetails(req, res) {
  try {
    const user = await adminService.getUserDetails(req.params.userId);
    res.json({ success: true, data: user });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message || 'User not found', code: error.code || 'USER_NOT_FOUND' });
  }
}

export async function updateUserStatus(req, res) {
  try {
    const { status, reason } = req.body;
    const result = await adminService.updateUserStatus(req.params.userId, status, reason);
    res.json({ success: true, message: result.message });
  } catch (error) {
    const s = error.code === 'USER_NOT_FOUND' ? 404 : error.code === 'INVALID_STATUS' ? 400 : 500;
    res.status(s).json({ success: false, message: error.message || 'Failed to update user status', code: error.code || 'UPDATE_FAILED' });
  }
}

export async function deleteUser(req, res) {
  try {
    const softDelete = req.query.soft !== 'false';
    const result = await adminService.deleteUser(req.params.userId, softDelete);
    res.json({ success: true, message: result.message });
  } catch (error) {
    const s = error.code === 'USER_NOT_FOUND' ? 404 : error.code === 'CANNOT_DELETE_ADMIN' ? 403 : 500;
    res.status(s).json({ success: false, message: error.message || 'Failed to delete user', code: error.code || 'DELETE_FAILED' });
  }
}

export async function getPayments(req, res) {
  try {
    let query = supabase.from('payments').select('*, user:users!payments_user_id_fkey(id, full_name, email)');
    if (req.query.status) query = query.eq('status', req.query.status);
    if (req.query.plan) query = query.eq('selected_plan', parseInt(req.query.plan));
    query = query.order('created_at', { ascending: false });
    const { data: payments, error } = await query;
    if (error) throw { message: 'Failed to fetch payments', code: 'FETCH_FAILED' };
    res.json({ success: true, data: payments || [] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch payments', code: error.code || 'FETCH_FAILED' });
  }
}

export async function approvePayment(req, res) {
  try {
    const result = await paymentService.approvePayment(req.params.paymentId, req.user.id);
    res.json({ success: true, message: result.message });
  } catch (error) {
    const s = error.code === 'PAYMENT_NOT_FOUND' ? 404 : error.code === 'PAYMENT_NOT_PENDING' ? 400 : 500;
    res.status(s).json({ success: false, message: error.message || 'Failed to approve payment', code: error.code || 'APPROVE_FAILED' });
  }
}

export async function rejectPayment(req, res) {
  try {
    const { reason } = req.body;
    const result = await paymentService.rejectPayment(req.params.paymentId, req.user.id, reason);
    res.json({ success: true, message: result.message });
  } catch (error) {
    const s = error.code === 'PAYMENT_NOT_FOUND' ? 404 : error.code === 'PAYMENT_NOT_PENDING' ? 400 : 500;
    res.status(s).json({ success: false, message: error.message || 'Failed to reject payment', code: error.code || 'REJECT_FAILED' });
  }
}

export async function deletePayment(req, res) {
  try {
    const result = await paymentService.deletePayment(req.params.paymentId, req.user.id);
    const status = result.alreadyDeleted ? 200 : 200;
    res.status(status).json({ success: true, message: result.message, data: result });
  } catch (error) {
    const s = error.code === 'FINANCIAL_HISTORY_EXISTS' ? 409 :
             error.code === 'DELETE_FAILED' ? 500 : 500;
    res.status(s).json({ success: false, message: error.message || 'Failed to delete payment', code: error.code || 'DELETE_FAILED' });
  }
}

export async function getTopups(req, res) {
  try {
    let query = supabase.from('topups').select('*, sender:users!topups_sender_id_fkey(id, full_name, email), receiver:users!topups_receiver_id_fkey(id, full_name, email)');
    if (req.query.status) query = query.eq('status', req.query.status);
    query = query.order('created_at', { ascending: false });
    const { data: topups, error } = await query;
    if (error) throw { message: 'Failed to fetch topups', code: 'FETCH_FAILED' };
    res.json({ success: true, data: topups || [] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch topups', code: error.code || 'FETCH_FAILED' });
  }
}

export async function deleteTopup(req, res) {
  try {
    const { data: topup, error: fetchError } = await supabase.from('topups').select('id').eq('id', req.params.topupId).single();
    if (fetchError || !topup) return res.status(404).json({ success: false, message: 'Topup not found', code: 'TOPUP_NOT_FOUND' });
    const { error } = await supabase.from('topups').delete().eq('id', req.params.topupId);
    if (error) throw { message: 'Failed to delete topup', code: 'DELETE_FAILED' };
    await logAction(req.user.id, 'admin', 'delete_topup', req.params.topupId, 'topup', {});
    res.json({ success: true, message: 'Topup deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to delete topup', code: error.code || 'DELETE_FAILED' });
  }
}

export async function getPlanChangeRequests(req, res) {
  try {
    const requests = await planService.getAllPlanChangeRequests();
    res.json({ success: true, data: requests });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch plan change requests', code: error.code || 'FETCH_FAILED' });
  }
}

export async function approvePlanChangeRequest(req, res) {
  try {
    const result = await planService.approvePlanChange(req.params.requestId, req.user.id);
    res.json({ success: true, message: result.message });
  } catch (error) {
    const s = error.code === 'REQUEST_NOT_FOUND' ? 404 : error.code === 'NOT_PENDING' ? 400 : 500;
    res.status(s).json({ success: false, message: error.message || 'Failed to approve', code: error.code || 'APPROVE_FAILED' });
  }
}

export async function rejectPlanChangeRequest(req, res) {
  try {
    const { reason } = req.body;
    const result = await planService.rejectPlanChange(req.params.requestId, req.user.id, reason);
    res.json({ success: true, message: result.message });
  } catch (error) {
    const s = error.code === 'REQUEST_NOT_FOUND' ? 404 : error.code === 'NOT_PENDING' ? 400 : 500;
    res.status(s).json({ success: false, message: error.message || 'Failed to reject', code: error.code || 'REJECT_FAILED' });
  }
}

export async function deletePlanChange(req, res) {
  try {
    const { data: request, error: fetchError } = await supabase.from('plan_change_requests').select('id').eq('id', req.params.requestId).single();
    if (fetchError || !request) return res.status(404).json({ success: false, message: 'Not found', code: 'REQUEST_NOT_FOUND' });
    const { error } = await supabase.from('plan_change_requests').delete().eq('id', req.params.requestId);
    if (error) throw { message: 'Failed to delete', code: 'DELETE_FAILED' };
    await logAction(req.user.id, 'admin', 'delete_plan_change', req.params.requestId, 'plan_change', {});
    res.json({ success: true, message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message, code: error.code || 'DELETE_FAILED' });
  }
}

export async function getInactiveUsers(req, res) {
  try {
    const users = await adminService.getInactiveUsers();
    res.json({ success: true, data: users });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch inactive users', code: error.code || 'FETCH_FAILED' });
  }
}

export async function activateUser(req, res) {
  try {
    const result = await adminService.activateUser(req.params.userId);
    res.json({ success: true, message: result.message });
  } catch (error) {
    const s = error.code === 'USER_NOT_FOUND' ? 404 : error.code === 'USER_ALREADY_ACTIVE' ? 400 : 500;
    res.status(s).json({ success: false, message: error.message || 'Failed to activate', code: error.code || 'ACTIVATE_FAILED' });
  }
}

export async function getChats(req, res) {
  try {
    const conversations = await chatService.getConversations();
    res.json({ success: true, data: conversations });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch chats', code: error.code || 'FETCH_FAILED' });
  }
}

export async function getChatMessages(req, res) {
  try {
    const messages = await chatService.getMessages(req.params.conversationId, req.user.id);
    res.json({ success: true, data: messages });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch messages', code: error.code || 'FETCH_FAILED' });
  }
}

export async function markChatRead(req, res) {
  try {
    const result = await chatService.markAsRead(req.params.conversationId, req.user.id);
    res.json({ success: true, message: result.message });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed', code: error.code || 'MARK_READ_FAILED' });
  }
}

export async function sendAdminMessage(req, res) {
  try {
    const { conversation_id, message } = req.body;
    if (!conversation_id || !message) return res.status(400).json({ success: false, message: 'conversation_id and message required', code: 'VALIDATION_ERROR' });
    const msg = await chatService.sendMessage(conversation_id, req.user.id, 'admin', message);
    res.json({ success: true, data: msg });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to send', code: error.code || 'SEND_FAILED' });
  }
}

export async function getAuditLogs(req, res) {
  try {
    let query = supabase.from('audit_logs').select('*');
    if (req.query.action) query = query.eq('action', req.query.action);
    if (req.query.actor_role) query = query.eq('actor_role', req.query.actor_role);
    if (req.query.target_type) query = query.eq('target_type', req.query.target_type);
    query = query.order('created_at', { ascending: false });
    const { data: logs, error } = await query;
    if (error) throw { message: 'Failed to fetch audit logs', code: 'FETCH_FAILED' };
    res.json({ success: true, data: logs || [] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch audit logs', code: error.code || 'FETCH_FAILED' });
  }
}
