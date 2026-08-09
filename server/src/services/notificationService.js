import supabase from '../db/supabase.js';

class NotificationService {
  async createNotification(userId, type, title, message, metadata = {}) {
    const { data, error } = await supabase
      .from('notifications')
      .insert({ user_id: userId, type, title, message, metadata })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async getNotifications(userId, { page = 1, limit = 20, unreadOnly = false } = {}) {
    let query = supabase
      .from('notifications')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (unreadOnly) query = query.eq('read', false);

    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    return {
      notifications: data,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        totalPages: Math.ceil(count / limit)
      }
    };
  }

  async markAsRead(notificationId, userId) {
    const { data, error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', notificationId)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async markAllAsRead(userId) {
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false);
    if (error) throw error;
    return true;
  }

  async getUnreadCount(userId) {
    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('read', false);
    if (error) throw error;
    return count;
  }

  async deleteNotification(notificationId, userId) {
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', notificationId)
      .eq('user_id', userId);
    if (error) throw error;
    return true;
  }
}

export default new NotificationService();
