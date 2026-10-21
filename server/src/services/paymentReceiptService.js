import supabase from '../db/supabase.js';
import { escapeHtml } from '../utils/helpers.js';

class PaymentReceiptService {
  // Ownership gate for receipt lookups. Mirrors paymentService.requirePaymentOwner:
  // only the payment's owner or an admin may read a receipt. The check runs on
  // the server against the DB row — no client-supplied owner field is trusted.
  async #authorizePaymentOwner(payment, requester) {
    if (payment.user_id !== requester?.id && requester?.role !== 'admin') {
      throw { message: 'Unauthorized', code: 'UNAUTHORIZED' };
    }
  }

  async #buildReceipt(payment) {
    const { data: topups } = await supabase
      .from('topups')
      .select('*')
      .eq('user_id', payment.user_id)
      .order('created_at', { ascending: false })
      .limit(1);

    return {
      receiptId: `RCP-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
      paymentId: payment.id,
      userName: payment.users?.full_name || 'N/A',
      userEmail: payment.users?.email || 'N/A',
      userPhone: payment.users?.mobile || 'N/A',
      amount: parseFloat(payment.expected_amount),
      utrNumber: payment.transaction_id,
      status: payment.status,
      planMonths: topups?.[0]?.plan || 1,
      approvedAt: payment.approved_at,
      createdAt: payment.created_at,
      generatedAt: new Date().toISOString()
    };
  }

  async generateReceipt(paymentId, requester) {
    const { data: payment, error: pErr } = await supabase
      .from('payments')
      .select('*, users:user_id(id, full_name, email, mobile)')
      .eq('id', paymentId)
      .single();
    if (pErr || !payment) throw { message: 'Payment not found', code: 'PAYMENT_NOT_FOUND' };

    await this.#authorizePaymentOwner(payment, requester);

    return this.#buildReceipt(payment);
  }

  async getUserReceipts(userId, { page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    const { data, error, count } = await supabase
      .from('payments')
      .select('*, users:user_id(id, full_name, email, mobile)', { count: 'exact' })
      .eq('user_id', userId)
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw { message: 'Failed to fetch payments', code: 'FETCH_FAILED' };

    const receipts = [];
    for (const p of data) {
      receipts.push(await this.#buildReceipt(p));
    }

    return {
      receipts,
      pagination: { page: parseInt(page), limit: parseInt(limit), total: count, totalPages: Math.ceil(count / limit) }
    };
  }

  generateHTML(receipt) {
    // Every value interpolated into the page is untrusted (user-controlled
    // profile fields, OCR-derived UTR, DB status) and is HTML-escaped for
    // its context before rendering.
    const receiptId = escapeHtml(receipt.receiptId);
    const createdDate = escapeHtml(new Date(receipt.createdAt).toLocaleDateString('en-IN'));
    const userName = escapeHtml(receipt.userName);
    const userEmail = escapeHtml(receipt.userEmail);
    const utrNumber = escapeHtml(receipt.utrNumber);
    const planMonths = escapeHtml(receipt.planMonths);
    const amount = escapeHtml(receipt.amount);
    const status = escapeHtml(String(receipt.status || '').toUpperCase());
    const generatedAt = escapeHtml(new Date(receipt.generatedAt).toLocaleString('en-IN'));

    return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; color: #333; }
    .receipt { border: 2px solid #6366f1; border-radius: 12px; padding: 30px; max-width: 600px; margin: 0 auto; }
    .header { text-align: center; border-bottom: 2px solid #e5e7eb; padding-bottom: 20px; margin-bottom: 20px; }
    .header h1 { color: #6366f1; margin: 0; font-size: 24px; }
    .header p { color: #6b7280; margin: 5px 0 0; }
    .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
    .label { font-weight: bold; color: #6b7280; }
    .value { color: #111827; }
    .amount { font-size: 24px; color: #6366f1; font-weight: bold; }
    .status { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: bold; }
    .approved { background: #d1fae5; color: #065f46; }
    .footer { text-align: center; margin-top: 20px; color: #9ca3af; font-size: 12px; }
  </style>
</head>
<body>
  <div class="receipt">
    <div class="header">
      <h1>ReferralHub</h1>
      <p>Payment Receipt</p>
    </div>
    <div class="row"><span class="label">Receipt ID</span><span class="value">${receiptId}</span></div>
    <div class="row"><span class="label">Date</span><span class="value">${createdDate}</span></div>
    <div class="row"><span class="label">Name</span><span class="value">${userName}</span></div>
    <div class="row"><span class="label">Email</span><span class="value">${userEmail}</span></div>
    <div class="row"><span class="label">UTR Number</span><span class="value">${utrNumber}</span></div>
    <div class="row"><span class="label">Plan</span><span class="value">${planMonths} month(s)</span></div>
    <div class="row"><span class="label">Amount</span><span class="value amount">₹${amount}</span></div>
    <div class="row"><span class="label">Status</span><span class="status approved">${status}</span></div>
    <div class="footer">
      <p>This is a computer-generated receipt. No signature required.</p>
      <p>Generated: ${generatedAt}</p>
    </div>
  </div>
</body>
</html>`;
  }
}

export default new PaymentReceiptService();
