import { useState, useEffect, useRef } from 'react';
import { Send, MessageSquare } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import EmptyState from '../../components/EmptyState';
import LoadingSpinner from '../../components/LoadingSpinner';

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
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Chat Management</h1>
      <div className="flex gap-4" style={{ height: 'calc(100vh - 12rem)' }}>
        <div className="w-72 flex-shrink-0 card overflow-y-auto p-0">
          <div className="p-3 border-b font-semibold text-sm">Users</div>
          {conversations.length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-sm">No conversations</div>
          ) : conversations.map(c => (
            <button key={c.id} onClick={() => openChat(c)} className={`w-full text-left p-3 border-b hover:bg-gray-50 flex items-center justify-between ${selectedConv?.id === c.id ? 'bg-primary-50' : ''}`}>
              <span className="text-sm font-medium truncate">{c.user_name || c.user_email || c.user_id?.slice(0,8)}</span>
              {c.unread_count > 0 && <span className="bg-red-500 text-white text-xs rounded-full px-2 py-0.5">{c.unread_count}</span>}
            </button>
          ))}
        </div>
        <div className="flex-1 card flex flex-col p-0">
          {!selectedConv ? (
            <div className="flex-1 flex items-center justify-center text-gray-400"><MessageSquare className="h-12 w-12" /></div>
          ) : (
            <>
              <div className="p-3 border-b font-semibold">{selectedConv.user_name || selectedConv.user_email}</div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.length === 0 && <p className="text-gray-400 text-center">No messages yet</p>}
                {messages.map(m => (
                  <div key={m.id} className={`flex ${m.sender_role === 'admin' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-2xl ${m.sender_role === 'admin' ? 'bg-primary-600 text-white rounded-br-md' : 'bg-gray-200 text-gray-900 rounded-bl-md'}`}>
                      <p className="text-sm">{m.message}</p>
                      <p className={`text-xs mt-1 ${m.sender_role === 'admin' ? 'text-primary-200' : 'text-gray-500'}`}>{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
              <div className="border-t p-3 flex gap-2">
                <input className="input-field flex-1" placeholder="Type a reply..." value={newMsg} onChange={e => setNewMsg(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSend()} />
                <button onClick={handleSend} disabled={sending || !newMsg.trim()} className="btn-primary px-4"><Send className="h-4 w-4" /></button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
