import { useState, useEffect, useRef } from 'react';
import { Send, MessageSquare } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import EmptyState from '../../components/EmptyState';
import LoadingSpinner from '../../components/LoadingSpinner';

export default function Chat() {
  const [messages, setMessages] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [newMsg, setNewMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  useEffect(() => {
    api.get('/chat/conversations').then(r => {
      const conv = r.data.data;
      setConversation(conv);
      if (conv?.id) {
        api.get(`/chat/messages/${conv.id}`).then(r2 => setMessages(r2.data.data || []));
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!conversation?.id) return;
    const interval = setInterval(() => {
      api.get(`/chat/messages/${conversation.id}`).then(r => setMessages(r.data.data || [])).catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [conversation?.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    if (conversation?.id) {
      api.put(`/chat/read/${conversation.id}`).catch(() => {});
    }
  }, [conversation?.id, messages.length]);

  const handleSend = async () => {
    if (!newMsg.trim() || sending) return;
    setSending(true);
    try {
      await api.post('/chat/messages', { conversation_id: conversation.id, message: newMsg.trim() });
      setNewMsg('');
      const r = await api.get(`/chat/messages/${conversation.id}`);
      setMessages(r.data.data || []);
    } catch (err) { toast.error('Failed to send'); }
    finally { setSending(false); }
  };

  if (loading) return <LoadingSpinner fullPage />;

  return (
    <div className="flex flex-col h-[calc(100vh-10rem)]">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Chat with Admin</h1>
        <p className="text-sm text-gray-500 mt-1">Messages are answered by the support team</p>
      </div>
      <div className="flex-1 card flex flex-col overflow-hidden p-0">
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50/40">
          {messages.length === 0 && <EmptyState icon={<MessageSquare className="h-8 w-8" />} title="No messages" description="Start a conversation with admin." />}
          {messages.map(m => (
            <div key={m.id} className={`flex ${m.sender_role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-2xl shadow-sm ${m.sender_role === 'user' ? 'bg-primary-600 text-white rounded-br-md' : 'bg-white text-gray-900 border border-gray-200 rounded-bl-md'}`}>
                <p className="text-sm">{m.message}</p>
                <p className={`text-xs mt-1 ${m.sender_role === 'user' ? 'text-primary-200' : 'text-gray-400'}`}>{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <div className="border-t border-gray-100 p-3 flex gap-2 bg-white">
          <input className="input-field flex-1" placeholder="Type a message..." value={newMsg} onChange={e => setNewMsg(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSend()} />
          <button onClick={handleSend} disabled={sending || !newMsg.trim()} className="btn-primary px-4" aria-label="Send message"><Send className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  );
}