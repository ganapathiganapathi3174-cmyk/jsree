import supabase from '../db/supabase.js';

class ExportService {
  async exportUsers() {
    const { data, error } = await supabase
      .from('users')
      .select('id, full_name, email, mobile, status, referral_tier, wallet_balance, referred_by, created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async exportPayments() {
    const { data, error } = await supabase
      .from('payments')
      .select('*, users:user_id(full_name, email)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data.map(p => ({
      id: p.id,
      user_name: p.users?.full_name,
      user_email: p.users?.email,
      amount: p.expected_amount,
      utr_number: p.transaction_id,
      status: p.status,
      created_at: p.created_at,
      approved_at: p.approved_at
    }));
  }

  async exportTopups() {
    const { data, error } = await supabase
      .from('topups')
      .select('*, users:user_id(full_name, email)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data.map(t => ({
      id: t.id,
      user_name: t.users?.full_name,
      user_email: t.users?.email,
      amount: t.amount,
      plan: t.plan,
      status: t.status,
      created_at: t.created_at
    }));
  }

  toCSV(data) {
    if (!data || data.length === 0) return '';
    const headers = Object.keys(data[0]);
    const rows = data.map(row =>
      headers.map(h => {
        let val = row[h];
        if (val === null || val === undefined) val = '';
        if (typeof val === 'string' && (val.includes(',') || val.includes('"') || val.includes('\n'))) {
          val = '"' + val.replace(/"/g, '""') + '"';
        }
        return val;
      }).join(',')
    );
    return [headers.join(','), ...rows].join('\n');
  }

  async getFinancialSummary({ startDate, endDate } = {}) {
    let paymentsQuery = supabase
      .from('payments')
      .select('expected_amount, status, created_at')
      .order('created_at', { ascending: false });

    if (startDate) paymentsQuery = paymentsQuery.gte('created_at', startDate);
    if (endDate) paymentsQuery = paymentsQuery.lte('created_at', endDate);

    const { data: payments, error: pErr } = await paymentsQuery;
    if (pErr) throw pErr;

    let topupsQuery = supabase
      .from('topups')
      .select('amount, plan, created_at')
      .order('created_at', { ascending: false });

    if (startDate) topupsQuery = topupsQuery.gte('created_at', startDate);
    if (endDate) topupsQuery = topupsQuery.lte('created_at', endDate);

    const { data: topups, error: tErr } = await topupsQuery;
    if (tErr) throw tErr;

    const approvedPayments = payments.filter(p => p.status === 'approved');
    const totalRevenue = approvedPayments.reduce((s, p) => s + parseFloat(p.expected_amount), 0);
    const pendingPayments = payments.filter(p => p.status === 'pending');
    const pendingAmount = pendingPayments.reduce((s, p) => s + parseFloat(p.expected_amount), 0);
    const totalTopups = topups.reduce((s, t) => s + parseFloat(t.amount), 0);

    const dailyRevenue = {};
    approvedPayments.forEach(p => {
      const day = p.created_at.split('T')[0];
      dailyRevenue[day] = (dailyRevenue[day] || 0) + parseFloat(p.expected_amount);
    });

    const monthlyRevenue = {};
    approvedPayments.forEach(p => {
      const month = p.created_at.substring(0, 7);
      monthlyRevenue[month] = (monthlyRevenue[month] || 0) + parseFloat(p.expected_amount);
    });

    return {
      totalRevenue,
      pendingAmount,
      totalTopups,
      totalTransactions: payments.length,
      approvedCount: approvedPayments.length,
      rejectedCount: payments.filter(p => p.status === 'rejected').length,
      dailyRevenue,
      monthlyRevenue
    };
  }
}

export default new ExportService();
