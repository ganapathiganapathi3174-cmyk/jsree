import supabase from '../db/supabase.js';

class SuspiciousActivityService {
  async logSuspiciousActivity(userId, ipAddress, activityType, severity = 'low', details = {}) {
    const { data, error } = await supabase
      .from('suspicious_activity')
      .insert({
        user_id: userId,
        ip_address: ipAddress,
        activity_type: activityType,
        severity,
        details
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async checkMultipleAccountsSameIP(ipAddress) {
    const { data, error } = await supabase
      .from('ip_logs')
      .select('user_id')
      .eq('ip_address', ipAddress)
      .eq('event_type', 'register');
    if (error) throw error;

    const uniqueUsers = [...new Set(data.map(d => d.user_id))];
    if (uniqueUsers.length >= 3) {
      return this.logSuspiciousActivity(
        null, ipAddress, 'multiple_accounts_same_ip', 'high',
        { user_count: uniqueUsers.length, user_ids: uniqueUsers }
      );
    }
    return null;
  }

  async checkRapidPayments(userId) {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { count, error } = await supabase
      .from('payments')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', fiveMinAgo);
    if (error) throw error;

    if (count >= 3) {
      const { data: ipLog } = await supabase.from('ip_logs').select('ip_address').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).single();
      return this.logSuspiciousActivity(
        userId, ipLog?.ip_address || 'unknown', 'rapid_payments', 'medium',
        { payment_count: count, window: '5_minutes' }
      );
    }
    return null;
  }

  async checkBulkReferrals(referrerId) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error } = await supabase
      .from('referrals')
      .select('*', { count: 'exact', head: true })
      .eq('referrer_id', referrerId)
      .gte('created_at', oneHourAgo);
    if (error) throw error;

    if (count >= 5) {
      const { data: user } = await supabase.from('users').select('ip_address').eq('id', referrerId).single();
      return this.logSuspiciousActivity(
        referrerId, user?.ip_address || 'unknown', 'bulk_referrals', 'medium',
        { referral_count: count, window: '1_hour' }
      );
    }
    return null;
  }

  async getSuspiciousActivities({ page = 1, limit = 20, resolved = null, severity = null } = {}) {
    let query = supabase
      .from('suspicious_activity')
      .select('*, users:user_id(id, name, email)', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (resolved !== null) query = query.eq('resolved', resolved);
    if (severity) query = query.eq('severity', severity);

    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    return {
      activities: data,
      pagination: { page: parseInt(page), limit: parseInt(limit), total: count, totalPages: Math.ceil(count / limit) }
    };
  }

  async resolveActivity(activityId, resolvedBy) {
    const { data, error } = await supabase
      .from('suspicious_activity')
      .update({ resolved: true, resolved_by: resolvedBy, resolved_at: new Date().toISOString() })
      .eq('id', activityId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}

export default new SuspiciousActivityService();
