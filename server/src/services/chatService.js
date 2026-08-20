import { supabase } from '../db/supabase.js';

export async function getOrCreateConversation(userId) {
  const { data: existing } = await supabase.from('conversations').select('id').eq('user_id', userId).single();
  if (existing) return existing.id;

  const { data: conversation, error } = await supabase.from('conversations').insert({ user_id: userId }).select('id').single();
  if (error) throw { message: 'Failed to create conversation', code: 'CONVERSATION_CREATE_FAILED' };
  return conversation.id;
}

export async function getConversations() {
  const { data: conversations, error } = await supabase.from('conversations')
    .select('*, user:users!conversations_user_id_fkey(id, full_name, email)')
    .order('last_message_at', { ascending: false, nullsFirst: false });
  if (error) throw { message: 'Failed to fetch conversations', code: 'FETCH_FAILED' };

  const enriched = await Promise.all(conversations.map(async (conv) => {
    const { count } = await supabase.from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conv.id).eq('sender_role', 'user').is('read_at', null);
    const { data: lastMessage } = await supabase.from('messages')
      .select('message, sender_role, created_at').eq('conversation_id', conv.id)
      .order('created_at', { ascending: false }).limit(1).single();
    return { ...conv, unreadCount: count || 0, lastMessage: lastMessage || null };
  }));

  return enriched;
}

export async function getMessages(conversationId, userId, userRole) {
  const { data: conversation } = await supabase.from('conversations').select('id, user_id').eq('id', conversationId).single();
  if (!conversation) throw { message: 'Conversation not found', code: 'CONVERSATION_NOT_FOUND' };
  if (userRole !== 'admin' && conversation.user_id !== userId) throw { message: 'Unauthorized', code: 'UNAUTHORIZED' };

  const { data: messages, error } = await supabase.from('messages')
    .select('*').eq('conversation_id', conversationId).order('created_at', { ascending: true });
  if (error) throw { message: 'Failed to fetch messages', code: 'FETCH_FAILED' };
  return messages;
}

export async function sendMessage(conversationId, senderId, senderRole, message) {
  const { data: conversation } = await supabase.from('conversations').select('id, user_id').eq('id', conversationId).single();
  if (!conversation) throw { message: 'Conversation not found', code: 'CONVERSATION_NOT_FOUND' };
  // A user may only send inside their own conversation; admins can reply to any.
  if (senderRole !== 'admin' && conversation.user_id !== senderId) throw { message: 'Unauthorized', code: 'UNAUTHORIZED' };

  const { data: msg, error } = await supabase.from('messages').insert({
    conversation_id: conversationId, sender_id: senderId, sender_role: senderRole, message: message.trim()
  }).select('*').single();
  if (error) throw { message: 'Failed to send message', code: 'SEND_FAILED' };

  await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId);
  return msg;
}

export async function markAsRead(conversationId, userId, userRole) {
  const { data: conversation } = await supabase.from('conversations').select('id, user_id').eq('id', conversationId).single();
  if (!conversation) throw { message: 'Conversation not found', code: 'CONVERSATION_NOT_FOUND' };
  // Access control mirrors getMessages: only the owner may mark their own.
  if (userRole !== 'admin' && conversation.user_id !== userId) throw { message: 'Unauthorized', code: 'UNAUTHORIZED' };

  const { error } = await supabase.from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId).neq('sender_id', userId).is('read_at', null);
  if (error) throw { message: 'Failed to mark messages as read', code: 'MARK_READ_FAILED' };
  return { message: 'Messages marked as read' };
}

export async function getUnreadCount(userId) {
  const { data: conversation } = await supabase.from('conversations').select('id').eq('user_id', userId).single();
  if (!conversation) return { count: 0 };

  const { count, error } = await supabase.from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id).eq('sender_role', 'admin').is('read_at', null);
  if (error) throw { message: 'Failed to get unread count', code: 'COUNT_FAILED' };
  return { count: count || 0 };
}
