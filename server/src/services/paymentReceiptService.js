import supabase from '../db/supabase.js';

class PaymentReceiptService {
  async generateReceipt(paymentId) {
    const { data: payment, error: pErr } = await supabase
      .from('payments')
      .select('*, users:user_id(id, full_name, email, mobile)')
      .eq('id', paymentId)
      .single();
    if (pErr) throw pErr;

    const { data: topups } = await supabase
      .from('topups')
      .select('*')
      .eq('user_id', payment.user_id)
      .order('created_at', { ascending: false })
      .limit(1);

    const receipt = {
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

    return receipt;
  }

  async getUserReceipts(userId, { page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    const { data, error, count } = await supabase
      .from('payments')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;

    const receipts = [];
    for (const p of data) {
      receipts.push(await this.generateReceipt(p.id));
    }

    return {
      receipts,
      pagination: { page: parseInt(page), limit: parseInt(limit), total: count, totalPages: Math.ceil(count / limit) }
    };
  }

  generateHTML(receipt) {
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
    <div class="row"><span class="label">Receipt ID</span><span class="value">${receipt.receiptId}</span></div>
    <div class="row"><span class="label">Date</span><span class="value">${new Date(receipt.createdAt).toLocaleDateString('en-IN')}</span></div>
    <div class="row"><span class="label">Name</span><span class="value">${receipt.userName}</span></div>
    <div class="row"><span class="label">Email</span><span class="value">${receipt.userEmail}</span></div>
    <div class="row"><span class="label">UTR Number</span><span class="value">${receipt.utrNumber}</span></div>
    <div class="row"><span class="label">Plan</span><span class="value">${receipt.planMonths} month(s)</span></div>
    <div class="row"><span class="label">Amount</span><span class="value amount">₹${receipt.amount}</span></div>
    <div class="row"><span class="label">Status</span><span class="status approved">${receipt.status.toUpperCase()}</span></div>
    <div class="footer">
      <p>This is a computer-generated receipt. No signature required.</p>
      <p>Generated: ${new Date(receipt.generatedAt).toLocaleString('en-IN')}</p>
    </div>
  </div>
</body>
</html>`;
  }
}

export default new PaymentReceiptService();
