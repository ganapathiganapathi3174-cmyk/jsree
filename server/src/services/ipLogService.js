import supabase from '../db/supabase.js';

class IPLogService {
  async logEvent(userId, ipAddress, userAgent, eventType, metadata = {}) {
    const { data, error } = await supabase
      .from('ip_logs')
      .insert({
        user_id: userId,
        ip_address: ipAddress,
        user_agent: userAgent,
        event_type: eventType,
        metadata
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async getIPHistory(userId, { page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    const { data, error, count } = await supabase
      .from('ip_logs')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;

    return {
      logs: data,
      pagination: { page: parseInt(page), limit: parseInt(limit), total: count, totalPages: Math.ceil(count / limit) }
    };
  }

  async getIPsForUser(userId) {
    const { data, error } = await supabase
      .from('ip_logs')
      .select('ip_address')
      .eq('user_id', userId);
    if (error) throw error;
    return [...new Set(data.map(l => l.ip_address))];
  }

  async getUsersForIP(ipAddress) {
    const { data, error } = await supabase
      .from('ip_logs')
      .select('user_id')
      .eq('ip_address', ipAddress);
    if (error) throw error;
    return [...new Set(data.map(l => l.user_id).filter(Boolean))];
  }
}

export default new IPLogService();
