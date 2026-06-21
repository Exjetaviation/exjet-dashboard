// frontend/src/components/ItinerarySendModal.jsx
//
// Preview-then-send dialog for the passenger itinerary email. Shows the rendered
// email (with the live "Dear <name>" greeting) before anything is sent; the full
// itinerary PDF is attached server-side. Used by every trip page.
import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';

const inp = { width: '100%', marginTop: 4, padding: '8px 10px', fontSize: 13, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', boxSizing: 'border-box' };
const btnSecondary = { padding: '8px 16px', fontSize: 13, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' };
const btnPrimary = { padding: '8px 18px', fontSize: 13, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' };

export default function ItinerarySendModal({ dispatchId, onClose }) {
  const [to, setTo] = useState('');
  const [name, setName] = useState('');
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  const loadPreview = useCallback(async (nm) => {
    try {
      const url = `/api/scheduling/trips/${dispatchId}/itinerary/email-preview${nm ? `?name=${encodeURIComponent(nm)}` : ''}`;
      const r = await apiFetch(url);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed to build preview');
      setPreview(j);
      if (!nm && j.recipientName) setName(j.recipientName); // seed greeting first time
      setError(null);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, [dispatchId]);

  useEffect(() => { loadPreview(''); }, [loadPreview]);

  // Re-render the preview when the greeting name changes (debounced).
  useEffect(() => {
    if (loading) return undefined;
    const t = setTimeout(() => loadPreview(name), 400);
    return () => clearTimeout(t);
  }, [name, loading, loadPreview]);

  const send = async () => {
    if (!to.trim()) { setError('Enter a recipient email address.'); return; }
    setSending(true); setError(null);
    try {
      const r = await apiFetch(`/api/scheduling/trips/${dispatchId}/itinerary/send`, {
        method: 'POST', body: JSON.stringify({ to: to.trim(), recipientName: name }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Send failed (${r.status})`);
      setDone(true);
    } catch (e) { setError(e.message); }
    setSending(false);
  };

  return (
    <div onClick={() => onClose(done)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, width: 'min(680px, 100%)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ color: 'var(--text-primary)' }}>Send Passenger Itinerary</strong>
          <button onClick={() => onClose(done)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>

        {done ? (
          <div style={{ padding: 30, textAlign: 'center' }}>
            <div style={{ fontSize: 30 }}>✅</div>
            <p style={{ color: 'var(--text-primary)', marginTop: 8 }}>Itinerary sent to <strong>{to}</strong></p>
            <button onClick={() => onClose(true)} style={{ ...btnPrimary, marginTop: 14 }}>Done</button>
          </div>
        ) : (
          <>
            <div style={{ padding: 16, overflowY: 'auto' }}>
              {error && <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '8px 12px', color: 'var(--danger)', marginBottom: 12, fontSize: 13 }}>{error}</div>}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                <label style={{ flex: '1 1 220px', fontSize: 12, color: 'var(--text-secondary)' }}>Recipient email
                  <input value={to} onChange={(e) => setTo(e.target.value)} type="email" placeholder="client@email.com" style={inp} />
                </label>
                <label style={{ flex: '1 1 160px', fontSize: 12, color: 'var(--text-secondary)' }}>Greeting name
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="First name" style={inp} />
                </label>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>Subject: <span style={{ color: 'var(--text-primary)' }}>{preview?.subject || '…'}</span></div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
                {loading ? <p style={{ padding: 20, color: '#888', fontSize: 13 }}>Loading preview…</p>
                  : <iframe title="Email preview" srcDoc={preview?.html || ''} style={{ width: '100%', height: 430, border: 'none' }} />}
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 8 }}>The full itinerary PDF is attached automatically.</p>
            </div>
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => onClose(false)} style={btnSecondary}>Cancel</button>
              <button onClick={send} disabled={sending || loading} style={{ ...btnPrimary, opacity: sending || loading ? 0.6 : 1 }}>{sending ? 'Sending…' : 'Send Itinerary'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
