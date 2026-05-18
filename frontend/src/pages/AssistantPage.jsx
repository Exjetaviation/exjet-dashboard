import { useState, useRef, useEffect } from 'react';
import wings from '../assets/wings.png';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const SUGGESTIONS = [
  "What flights are scheduled this week?",
  "What's our revenue YTD?",
  "Which pilots are on duty today?",
  "Is N69FP available next week?",
  "What are our top clients by revenue?",
  "Summarize outstanding invoices",
  "What's our net income this year?",
  "Any maintenance scheduled?",
];

export default function AssistantPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const send = async (text) => {
    const content = text || input.trim();
    if (!content || loading) return;
    setInput('');
    const userMsg = { role: 'user', content };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/assistant/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages }),
      });
      const data = await res.json();
      setMessages(m => [...m, { role: 'assistant', content: data.reply || 'No response.' }]);
    } catch {
      setMessages(m => [...m, { role: 'assistant', content: 'Error reaching assistant. Please try again.' }]);
    }
    setLoading(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)', gap: '0' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '20px' }}>
        <img src={wings} alt="AI" style={{ width: '36px', opacity: 0.9 }} />
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '600', color: 'var(--text-primary)', margin: 0 }}>Exjet AI Assistant</h1>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>Ask anything about your operations, finances, crew, or flights</p>
        </div>
        {messages.length > 0 && (
          <button onClick={() => setMessages([])} style={{ marginLeft: 'auto', padding: '7px 14px', fontSize: '12px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            Clear chat
          </button>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: '16px' }}>

        {messages.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: '24px' }}>
            <img src={wings} alt="AI" style={{ width: '64px', opacity: 0.3 }} />
            <p style={{ fontSize: '16px', color: 'var(--text-secondary)', textAlign: 'center', margin: 0 }}>
              Ask me anything about Exjet Aviation
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', maxWidth: '600px' }}>
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => send(s)} style={{ padding: '8px 14px', fontSize: '12px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '20px', color: 'var(--text-secondary)', cursor: 'pointer', transition: 'all 0.15s' }}
                  onMouseEnter={e => { e.target.style.borderColor = 'var(--accent)'; e.target.style.color = 'var(--accent)'; }}
                  onMouseLeave={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.color = 'var(--text-secondary)'; }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: msg.role === 'user' ? 'var(--accent)' : 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
              {msg.role === 'user'
                ? <span style={{ fontSize: '13px', color: '#fff', fontWeight: '600' }}>S</span>
                : <img src={wings} alt="AI" style={{ width: '18px', opacity: 0.8 }} />
              }
            </div>
            <div style={{ maxWidth: '75%', background: msg.role === 'user' ? 'var(--accent)' : 'var(--bg-card)', border: `1px solid ${msg.role === 'user' ? 'var(--accent)' : 'var(--border)'}`, borderRadius: msg.role === 'user' ? '16px 4px 16px 16px' : '4px 16px 16px 16px', padding: '12px 16px' }}>
              <p style={{ fontSize: '14px', color: msg.role === 'user' ? '#fff' : 'var(--text-primary)', margin: 0, lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>{msg.content}</p>
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
              <img src={wings} alt="AI" style={{ width: '18px', opacity: 0.8 }} />
            </div>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '4px 16px 16px 16px', padding: '14px 18px', display: 'flex', gap: '5px', alignItems: 'center' }}>
              {[0,1,2].map(i => (
                <div key={i} style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--accent)', animation: 'pulse 1.2s infinite', animationDelay: `${i*0.2}s` }} />
              ))}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '12px 16px', display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Ask about flights, finances, crew, or anything else..."
          rows={1}
          style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: '14px', resize: 'none', lineHeight: '1.5', maxHeight: '120px', fontFamily: 'inherit' }}
          onInput={e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
        />
        <button onClick={() => send()} disabled={!input.trim() || loading}
          style={{ padding: '8px 16px', background: input.trim() && !loading ? 'var(--accent)' : 'var(--bg-secondary)', color: input.trim() && !loading ? '#fff' : 'var(--text-secondary)', border: `1px solid ${input.trim() && !loading ? 'var(--accent)' : 'var(--border)'}`, borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: input.trim() && !loading ? 'pointer' : 'default', transition: 'all 0.15s', whiteSpace: 'nowrap' }}>
          Send ↑
        </button>
      </div>

      <style>{`@keyframes pulse { 0%,100%{opacity:0.3;transform:scale(0.8)} 50%{opacity:1;transform:scale(1)} }`}</style>
    </div>
  );
}
