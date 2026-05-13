import { useState, useRef, useEffect } from 'react';
import wings from '../assets/wings.png';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const SUGGESTIONS = [
  "Summarize today's flights",
  "Who is flying this week?",
  "What is the status of N69FP?",
  "List upcoming trips and clients",
  "Who has the most flight hours this month?",
  "Draft a trip confirmation email for the next flight",
];

const TypingDots = () => (
  <div style={{ display: 'flex', gap: '4px', alignItems: 'center', padding: '4px 0' }}>
    {[0,1,2].map(i => (
      <div key={i} style={{
        width: '6px', height: '6px', borderRadius: '50%',
        background: 'var(--text-secondary)',
        animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
      }} />
    ))}
    <style>{`@keyframes bounce { 0%,80%,100%{transform:scale(0.7);opacity:0.4} 40%{transform:scale(1);opacity:1} }`}</style>
  </div>
);

export default function Assistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([{
        role: 'assistant',
        content: "Hi, I'm your Exjet Aviation operations assistant. I have live access to your flights, crew, and aircraft data. How can I help you today?",
      }]);
    }
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const send = async (text) => {
    const userText = text || input.trim();
    if (!userText || loading) return;
    setInput('');
    setError(null);
    const userMsg = { role: 'user', content: userText };
    const newMessages = [...messages.filter(m => m.role !== 'system'), userMsg];
    setMessages(newMessages);
    setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/assistant/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages.map(m => ({ role: m.role, content: m.content })) }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const onKey = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const clear = () => {
    setMessages([{ role: 'assistant', content: "Conversation cleared. How can I help you?" }]);
    setError(null);
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(o => !o)}
        title="Exjet AI Assistant"
        style={{
          position: 'fixed', bottom: '28px', right: '28px', zIndex: 900,
          width: '56px', height: '56px', borderRadius: '50%',
          background: open ? '#1a1a24' : '#0a0a0f',
          border: '1px solid var(--border)',
          cursor: 'pointer',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'transform .2s, background .2s',
          padding: 0,
        }}
      >
        {open ? (
          <span style={{ fontSize: '20px', color: 'var(--text-secondary)', lineHeight: 1 }}>✕</span>
        ) : (
          <img src={wings} alt="AI" style={{ width: '34px', height: '34px', objectFit: 'contain', borderRadius: '4px' }} />
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div style={{
          position: 'fixed', bottom: '96px', right: '28px', zIndex: 901,
          width: '380px', maxWidth: 'calc(100vw - 56px)',
          height: '560px', maxHeight: 'calc(100vh - 120px)',
          background: 'var(--bg-secondary)', border: '1px solid var(--border)',
          borderRadius: '16px', boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>

          {/* Header */}
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-card)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <img src={wings} alt="" style={{ width: '32px', height: '32px', objectFit: 'contain', borderRadius: '6px', background: '#000', padding: '3px' }} />
              <div>
                <p style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)', margin: 0 }}>Exjet AI Assistant</p>
                <p style={{ fontSize: '11px', color: 'var(--success)', margin: 0 }}>● Live operational data</p>
              </div>
            </div>
            <button onClick={clear} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer', padding: '4px 8px', borderRadius: '6px' }}>
              Clear
            </button>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {messages.map((msg, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', gap: '8px', alignItems: 'flex-end' }}>
                {msg.role === 'assistant' && (
                  <img src={wings} alt="" style={{ width: '22px', height: '22px', objectFit: 'contain', borderRadius: '4px', background: '#000', padding: '2px', flexShrink: 0, marginBottom: '2px' }} />
                )}
                <div style={{
                  maxWidth: '82%',
                  background: msg.role === 'user' ? 'var(--accent)' : 'var(--bg-card)',
                  color: msg.role === 'user' ? '#fff' : 'var(--text-primary)',
                  border: msg.role === 'user' ? 'none' : '1px solid var(--border)',
                  borderRadius: msg.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                  padding: '10px 13px', fontSize: '13px', lineHeight: '1.55',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                <img src={wings} alt="" style={{ width: '22px', height: '22px', objectFit: 'contain', borderRadius: '4px', background: '#000', padding: '2px', flexShrink: 0 }} />
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px 12px 12px 4px', padding: '10px 13px' }}>
                  <TypingDots />
                </div>
              </div>
            )}
            {error && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '8px 12px', fontSize: '12px', color: 'var(--danger)' }}>
                Error: {error}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Suggestions */}
          {messages.length <= 1 && (
            <div style={{ padding: '0 16px 12px', display: 'flex', flexWrap: 'wrap', gap: '6px', flexShrink: 0 }}>
              {SUGGESTIONS.map((s, i) => (
                <button key={i} onClick={() => send(s)} style={{
                  padding: '5px 10px', fontSize: '11px', borderRadius: '20px',
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  color: 'var(--text-secondary)', cursor: 'pointer', transition: 'all .15s',
                }}
                  onMouseEnter={e => { e.target.style.borderColor = 'var(--accent)'; e.target.style.color = 'var(--accent)'; }}
                  onMouseLeave={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.color = 'var(--text-secondary)'; }}
                >{s}</button>
              ))}
            </div>
          )}

          {/* Input */}
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: '8px', flexShrink: 0, background: 'var(--bg-card)' }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder="Ask anything about your operations..."
              rows={1}
              style={{
                flex: 1, resize: 'none', background: 'var(--bg-secondary)',
                border: '1px solid var(--border)', borderRadius: '8px',
                color: 'var(--text-primary)', fontSize: '13px',
                padding: '8px 12px', lineHeight: '1.4',
                outline: 'none', fontFamily: 'inherit',
                maxHeight: '80px', overflowY: 'auto',
              }}
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || loading}
              style={{
                width: '36px', height: '36px', borderRadius: '8px', flexShrink: 0,
                background: input.trim() && !loading ? 'var(--accent)' : 'var(--border)',
                border: 'none', color: '#fff', fontSize: '16px',
                cursor: input.trim() && !loading ? 'pointer' : 'default',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'background .15s', alignSelf: 'flex-end',
              }}
            >↑</button>
          </div>
        </div>
      )}
    </>
  );
}
