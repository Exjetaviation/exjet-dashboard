import { useState, useEffect } from 'react';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const STATUS_COLORS = {
  pending:  { bg: 'rgba(245,158,11,0.1)',  color: '#f59e0b',  border: 'rgba(245,158,11,0.2)',  label: 'Pending Review' },
  approved: { bg: 'rgba(79,142,247,0.1)',  color: '#4f8ef7',  border: 'rgba(79,142,247,0.2)',  label: 'Approved' },
  sent:     { bg: 'rgba(34,197,94,0.1)',   color: '#22c55e',  border: 'rgba(34,197,94,0.2)',   label: 'Sent' },
  rejected: { bg: 'rgba(239,68,68,0.1)',   color: '#ef4444',  border: 'rgba(239,68,68,0.2)',   label: 'Rejected' },
};

const fmt$ = v => v != null ? `$${Number(v).toLocaleString()}` : '—';
const fmtDate = ts => ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const fmtTime = ts => ts ? new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

export default function Quotes() {
  const [quotes, setQuotes]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [scanning, setScanning]   = useState(false);
  const [selected, setSelected]   = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const [saving, setSaving]       = useState(false);
  const [sending, setSending]     = useState(false);
  const [scanMsg, setScanMsg]     = useState(null);
  const [filter, setFilter]       = useState('all');

  const fetchQuotes = async () => {
    setLoading(true);
    const res = await fetch(`${BASE_URL}/api/quotes`);
    const data = await res.json();
    setQuotes(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  useEffect(() => { fetchQuotes(); }, []);

  const scan = async () => {
    setScanning(true); setScanMsg(null);
    try {
      const res = await fetch(`${BASE_URL}/api/quotes/scan`, { method: 'POST' });
      const data = await res.json();
      const created = data.results?.filter(r => r.status === 'quote_created').length || 0;
      setScanMsg({ type: created > 0 ? 'success' : 'info', text: created > 0 ? `${created} new quote${created > 1 ? 's' : ''} created` : `Scanned ${data.scanned} emails — no new quote requests found` });
      if (created > 0) await fetchQuotes();
    } catch (err) {
      setScanMsg({ type: 'error', text: err.message });
    } finally {
      setScanning(false);
    }
  };

  const openQuote = (quote) => {
    setSelected(quote);
    setEditDraft(quote.quote_draft || '');
  };

  const saveDraft = async () => {
    if (!selected) return;
    setSaving(true);
    await fetch(`${BASE_URL}/api/quotes/${selected.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quote_draft: editDraft, status: 'approved' }),
    });
    await fetchQuotes();
    setSelected(prev => ({ ...prev, quote_draft: editDraft, status: 'approved' }));
    setSaving(false);
  };

  const sendQuote = async () => {
    if (!selected) return;
    if (!confirm('Send this quote to the client?')) return;
    setSending(true);
    try {
      const res = await fetch(`${BASE_URL}/api/quotes/${selected.id}/send`, { method: 'POST' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await fetchQuotes();
      setSelected(prev => ({ ...prev, status: 'sent' }));
    } catch (err) {
      alert('Send failed: ' + err.message);
    } finally {
      setSending(false);
    }
  };

  const rejectQuote = async (id) => {
    if (!confirm('Mark this quote as rejected?')) return;
    await fetch(`${BASE_URL}/api/quotes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'rejected' }),
    });
    await fetchQuotes();
    if (selected?.id === id) setSelected(prev => ({ ...prev, status: 'rejected' }));
  };

  const filtered = filter === 'all' ? quotes : quotes.filter(q => q.status === filter);

  const counts = {
    all:      quotes.length,
    pending:  quotes.filter(q => q.status === 'pending').length,
    approved: quotes.filter(q => q.status === 'approved').length,
    sent:     quotes.filter(q => q.status === 'sent').length,
    rejected: quotes.filter(q => q.status === 'rejected').length,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '600', color: 'var(--text-primary)', margin: 0 }}>Quotes</h1>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '3px' }}>
            Incoming charter quote requests — AI generated, dispatcher approved
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          {scanMsg && (
            <span style={{ fontSize: '12px', color: scanMsg.type === 'error' ? 'var(--danger)' : scanMsg.type === 'success' ? 'var(--success)' : 'var(--text-secondary)' }}>
              {scanMsg.text}
            </span>
          )}
          <button onClick={scan} disabled={scanning} style={{
            padding: '8px 18px', fontSize: '13px', fontWeight: '600',
            background: scanning ? 'var(--border)' : 'var(--accent)',
            color: '#fff', border: 'none', borderRadius: '8px', cursor: scanning ? 'default' : 'pointer',
          }}>
            {scanning ? 'Scanning...' : '📧 Scan Inbox'}
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {[['all', 'All'], ['pending', 'Pending'], ['approved', 'Approved'], ['sent', 'Sent'], ['rejected', 'Rejected']].map(([key, label]) => (
          <button key={key} onClick={() => setFilter(key)} style={{
            padding: '6px 14px', fontSize: '12px', fontWeight: filter === key ? '600' : '400',
            background: filter === key ? 'var(--accent)' : 'var(--bg-card)',
            color: filter === key ? '#fff' : 'var(--text-secondary)',
            border: `1px solid ${filter === key ? 'var(--accent)' : 'var(--border)'}`,
            borderRadius: '20px', cursor: 'pointer',
          }}>
            {label} {counts[key] > 0 && <span style={{ opacity: 0.8 }}>({counts[key]})</span>}
          </button>
        ))}
      </div>

      {/* Quote list */}
      {loading ? (
        <div style={{ padding: '60px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading...</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '60px', textAlign: 'center', color: 'var(--text-secondary)', background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--border)' }}>
          {filter === 'all' ? 'No quotes yet — click Scan Inbox to check for new requests' : `No ${filter} quotes`}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.map(quote => {
            const s = STATUS_COLORS[quote.status] || STATUS_COLORS.pending;
            return (
              <div key={quote.id}
                onClick={() => openQuote(quote)}
                style={{
                  background: selected?.id === quote.id ? 'rgba(79,142,247,0.06)' : 'var(--bg-card)',
                  border: `1px solid ${selected?.id === quote.id ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: '10px', padding: '14px 18px',
                  cursor: 'pointer', transition: 'all .15s',
                  display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap',
                }}
                onMouseEnter={e => { if (selected?.id !== quote.id) e.currentTarget.style.borderColor = 'var(--accent)'; }}
                onMouseLeave={e => { if (selected?.id !== quote.id) e.currentTarget.style.borderColor = 'var(--border)'; }}
              >
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                    <span style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)' }}>
                      {quote.parsed_origin || '?'} → {quote.parsed_destination || '?'}
                    </span>
                    <span style={{ fontSize: '11px', fontWeight: '600', padding: '2px 8px', borderRadius: '20px', background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
                      {s.label}
                    </span>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                    {quote.email_from} · {fmtTime(quote.created_at)}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                  {[
                    ['Date', fmtDate(quote.parsed_date)],
                    ['Pax', quote.parsed_pax || '—'],
                    ['Aircraft', quote.aircraft_tail || '—'],
                    ['Total', fmt$(quote.grand_total)],
                  ].map(([label, value]) => (
                    <div key={label} style={{ textAlign: 'right' }}>
                      <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
                      <p style={{ fontSize: '13px', fontWeight: '500', color: 'var(--text-primary)', margin: 0 }}>{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Quote detail panel */}
      {selected && (
        <div style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: '520px', maxWidth: '100vw',
          background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border)',
          zIndex: 800, display: 'flex', flexDirection: 'column',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.4)',
        }}>
          {/* Panel header */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: '600', color: 'var(--text-primary)', margin: 0 }}>
                {selected.parsed_origin} → {selected.parsed_destination}
              </h2>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>{selected.email_from}</p>
            </div>
            <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', fontSize: '20px', color: 'var(--text-secondary)', cursor: 'pointer' }}>✕</button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* Trip details */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '10px', padding: '14px 16px' }}>
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Trip Details</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                {[
                  ['Route', `${selected.parsed_origin} → ${selected.parsed_destination}`],
                  ['Date', fmtDate(selected.parsed_date)],
                  ['Passengers', selected.parsed_pax || '—'],
                  ['Aircraft', selected.aircraft_tail || '—'],
                  ['Flight Time', selected.flight_time_hrs ? `${selected.flight_time_hrs}hrs` : '—'],
                  ['Total', fmt$(selected.grand_total)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 2px' }}>{label}</p>
                    <p style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: '500', margin: 0 }}>{value}</p>
                  </div>
                ))}
              </div>
              {selected.parsed_notes && (
                <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border)' }}>
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 4px' }}>Special requests</p>
                  <p style={{ fontSize: '13px', color: 'var(--text-primary)', margin: 0 }}>{selected.parsed_notes}</p>
                </div>
              )}
            </div>

            {/* Pricing breakdown */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '10px', padding: '14px 16px' }}>
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pricing</p>
              {[
                ['Flight cost', fmt$(selected.grand_total - (selected.overnight_total || 0) - (selected.fees_total || 0) - (selected.fet_amount || 0))],
                ['Overnight fees', fmt$(selected.overnight_total)],
                ['Segment fees', fmt$(selected.fees_total)],
                ['FET tax', fmt$(selected.fet_amount)],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--border)', fontSize: '13px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: '500' }}>{value}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 0', fontSize: '15px' }}>
                <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>Total</span>
                <span style={{ fontWeight: '700', color: 'var(--accent)' }}>{fmt$(selected.grand_total)}</span>
              </div>
            </div>

            {/* Original email */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '10px', padding: '14px 16px' }}>
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Original Email</p>
              <p style={{ fontSize: '13px', fontWeight: '500', color: 'var(--text-primary)', margin: '0 0 6px' }}>{selected.email_subject}</p>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, whiteSpace: 'pre-wrap', maxHeight: '120px', overflowY: 'auto' }}>
                {selected.email_body?.slice(0, 600)}{selected.email_body?.length > 600 ? '...' : ''}
              </p>
            </div>

            {/* Quote draft editor */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '10px', padding: '14px 16px' }}>
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Quote Draft — edit before sending</p>
              <textarea
                value={editDraft}
                onChange={e => setEditDraft(e.target.value)}
                rows={12}
                style={{
                  width: '100%', resize: 'vertical',
                  background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                  borderRadius: '8px', color: 'var(--text-primary)', fontSize: '13px',
                  padding: '10px 12px', lineHeight: '1.55',
                  outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: '10px', flexShrink: 0, background: 'var(--bg-card)' }}>
            {selected.status !== 'sent' && (
              <>
                <button onClick={saveDraft} disabled={saving} style={{
                  flex: 1, padding: '10px', fontSize: '13px', fontWeight: '600',
                  background: saving ? 'var(--border)' : 'var(--bg-secondary)',
                  color: 'var(--text-primary)', border: '1px solid var(--border)',
                  borderRadius: '8px', cursor: saving ? 'default' : 'pointer',
                }}>
                  {saving ? 'Saving...' : '✓ Approve & Save'}
                </button>
                <button onClick={sendQuote} disabled={sending || selected.status === 'pending'} style={{
                  flex: 1, padding: '10px', fontSize: '13px', fontWeight: '600',
                  background: sending ? 'var(--border)' : selected.status === 'pending' ? 'rgba(34,197,94,0.3)' : 'var(--success)',
                  color: '#fff', border: 'none', borderRadius: '8px',
                  cursor: sending || selected.status === 'pending' ? 'default' : 'pointer',
                  opacity: selected.status === 'pending' ? 0.5 : 1,
                }}>
                  {sending ? 'Sending...' : selected.status === 'pending' ? 'Approve first →' : '✈ Send to Client'}
                </button>
                <button onClick={() => rejectQuote(selected.id)} style={{
                  padding: '10px 14px', fontSize: '13px',
                  background: 'rgba(239,68,68,0.1)', color: 'var(--danger)',
                  border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px', cursor: 'pointer',
                }}>✕</button>
              </>
            )}
            {selected.status === 'sent' && (
              <div style={{ flex: 1, padding: '10px', textAlign: 'center', fontSize: '13px', color: 'var(--success)', fontWeight: '600' }}>
                ✓ Quote sent {fmtTime(selected.sent_at)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
