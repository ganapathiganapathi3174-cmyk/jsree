import { useState, useEffect, useRef } from 'react';
import { Send, MessageSquare } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import EmptyState from '../../components/EmptyState';
import LoadingSpinner from '../../components/LoadingSpinner';
import PageHeader from '../../components/PageHeader';
import Avatar from '../../components/Avatar';

export default function AdminChat() {
  const [conversations, setConversations] = useState([]);
  const [selectedConv, setSelectedConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMsg, setNewMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    api.get('/admin/chats').then(r => setConversations(r.data.data || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const openChat = async (conv) => {
    setSelectedConv(conv);
    try {
      const r = await api.get(`/admin/chats/${conv.id}/messages`);
      setMessages(r.data.data || []);
      await api.put(`/admin/chats/${conv.id}/read`);
    } catch (err) { toast.error('Failed to load messages'); }
  };

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    if (!selectedConv?.id) return;
    const interval = setInterval(() => {
      api.get(`/admin/chats/${selectedConv.id}/messages`).then(r => setMessages(r.data.data || [])).catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [selectedConv?.id]);

  const handleSend = async () => {
    if (!newMsg.trim() || sending) return;
    setSending(true);
    try {
      await api.post('/admin/chats/messages', { conversation_id: selectedConv.id, message: newMsg.trim() });
      setNewMsg('');
      const r = await api.get(`/admin/chats/${selectedConv.id}/messages`);
      setMessages(r.data.data || []);
    } catch (err) { toast.error('Failed to send'); }
    finally { setSending(false); }
  };

  if (loading) return <LoadingSpinner fullPage />;

  return (
    <div className="space-y-4">
      <PageHeader title="Chat Management" description="Conversations with members" />
      <div className="flex flex-col lg:flex-row gap-4" style={{ height: 'calc(100vh - 13rem)' }}>
        <div className="lg:w-72 flex-shrink-0 card p-0 overflow-y-auto lg:max-h-none max-h-56">
          <div className="px-4 py-3 border-b border-line font-semibold text-sm text-ink sticky top-0 bg-surface">Users</div>
          {conversations.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-muted">No conversations</p>
          ) : conversations.map(c => (
            <button
              key={c.id}
              onClick={() => openChat(c)}
              aria-pressed={selectedConv?.id === c.id}
              className={`w-full text-left px-4 py-3 border-b border-line/60 hover:bg-surface-2 flex items-center justify-between gap-2 transition-colors ${selectedConv?.id === c.id ? 'bg-primary-500/10' : ''}`}
            >
              <span className="flex items-center gap-3 min-w-0">
                <Avatar user={{ full_name: c.user?.full_name || c.user?.email || c.user_id?.slice(0, 8) }} size={32} className="shrink-0" />
                <span className="text-sm font-medium text-ink truncate">{c.user?.full_name || c.user?.email || c.user_id?.slice(0,8)}</span>
              </span>
              {c.unreadCount > 0 && <span className="bg-error-600 text-white text-[11px] rounded-full min-w-5 h-5 px-1.5 flex items-center justify-center font-semibold shrink-0">{c.unreadCount}</span>}
            </button>
          ))}
        </div>
        <div className="flex-1 card flex flex-col p-0 min-w-0">
          {!selectedConv ? (
            <div className="flex-1 flex items-center justify-center">
              <EmptyState
                icon={<MessageSquare className="h-6 w-6" />}
                title="No conversation selected"
                description="Select a conversation to start replying"
              />
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-line font-semibold text-ink truncate flex items-center gap-2.5 bg-surface">
                <Avatar user={{ full_name: selectedConv.user?.full_name || selectedConv.user?.email }} size={28} className="shrink-0" />
                <span className="truncate">{selectedConv.user?.full_name || selectedConv.user?.email}</span>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-canvas/60">
                {messages.length === 0 && <p className="text-ink-faint text-center text-sm">No messages yet</p>}
                {messages.map(m => (
                  <div key={m.id} className={`flex ${m.sender_role === 'admin' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-2xl shadow-sm break-words ${m.sender_role === 'admin' ? 'bg-primary-600 text-white rounded-br-md' : 'bg-surface-2 text-ink border border-line rounded-bl-md'}`}>
                      <p className="text-sm">{m.message}</p>
                      <p className={`text-xs mt-1 ${m.sender_role === 'admin' ? 'text-primary-200' : 'text-ink-faint'}`}>{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
              <div className="border-t border-line p-3 flex gap-2 bg-surface">
                <input className="input-field flex-1" aria-label="Type a reply" placeholder="Type a reply..." value={newMsg} onChange={e => setNewMsg(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSend()} />
                <button onClick={handleSend} disabled={sending || !newMsg.trim()} className="btn btn-primary" aria-label="Send message"><Send className="h-4 w-4" aria-hidden="true" /></button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
