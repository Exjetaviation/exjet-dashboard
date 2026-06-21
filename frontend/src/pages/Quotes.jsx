import { useEffect, useMemo, useState } from 'react';
import { apiFetch, API_BASE } from '../lib/api';
import FlightsFilterBar from '../components/FlightsFilterBar';

const fmtDate = (ms) => ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const money = (n) => n == null ? '—' : '$' + Number(n).toLocaleString('en-US');

export default function Quotes() {
  const [rows, setRows] = useState([]);
  const [visible, setVisible] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(null);
  const [html, setHtml] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState('date'); // 'date' | 'quote'
  const [sortDir, setSortDir] = useState('desc'); // 'asc' | 'desc'
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailCc, setEmailCc] = useState('');
  const [emailMsg, setEmailMsg] = useState('');

  useEffect(() => {
    let on = true;
    apiFetch('/api/quotes/list').then((r) => r.json()).then((j) => { if (on) { setRows(j.quotes || []); setLoading(false); } }).catch(() => { if (on) setLoading(false); });
    return () => { on = false; };
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing preview to selected quote
    if (!sel) { setHtml(''); return; }
    let on = true; setPreviewLoading(true);
    apiFetch(`/api/quotes/dispatch/${sel}/preview`).then((r) => r.text()).then((t) => { if (on) { setHtml(t); setPreviewLoading(false); } }).catch(() => { if (on) { setHtml('<p style="color:#fff;padding:20px">Preview failed</p>'); setPreviewLoading(false); } });
    return () => { on = false; };
  }, [sel]);

  const downloadPdf = async () => {
    if (!sel) return;
    setPdfBusy(true);
    try {
      const r = await apiFetch(`/api/quotes/dispatch/${sel}/pdf`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const qn = rows.find((q) => q.dispatchId === sel)?.quoteNumber;
      const a = document.createElement('a'); a.href = url; a.download = `exjet-quote-${qn || sel}.pdf`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch { /* ignore */ }
    setPdfBusy(false);
  };

  const copyLink = () => {
    if (!sel) return;
    navigator.clipboard?.writeText(`${API_BASE}/quote/${sel}`);
    setEmailMsg('Client link copied to clipboard.');
  };
  const sendEmailLink = async () => {
    if (!sel || !emailTo.trim()) { setEmailMsg('Enter a client email first.'); return; }
    setEmailMsg('Sending…');
    try {
      const r = await apiFetch(`/api/quotes/dispatch/${sel}/send-link`, { method: 'POST', body: JSON.stringify({ to: emailTo.trim(), cc: emailCc.trim() }) });
      if (!r.ok) {
        let detail = '';
        try { const j = await r.json(); detail = j?.error ? `: ${j.error}` : ''; } catch { /* non-JSON body */ }
        setEmailMsg(`Failed (HTTP ${r.status})${detail}`);
        return;
      }
      setEmailMsg('Quote link sent ✓'); setEmailOpen(false); setEmailTo(''); setEmailCc('');
    } catch (e) { setEmailMsg(`Failed: ${e?.message || 'network error'}`); }
  };

  // The flights filter bar filters by `departure.time`; shape rows to match so we
  // reuse the same date-range/limit UX as the flights page. Memoized so it's a
  // STABLE reference (a fresh array each render makes the bar re-emit in a loop).
  const legsForFilter = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? rows.filter((r) => [r.from, r.to, r.tail, r.quoteNumber].some((v) => String(v || '').toLowerCase().includes(q)))
      : rows;
    const val = (r) => sortKey === 'quote' ? Number(r.quoteNumber) : r.depTime;
    const sorted = [...base].sort((a, b) => {
      const av = val(a), bv = val(b);
      const an = av == null || Number.isNaN(av), bn = bv == null || Number.isNaN(bv);
      if (an && bn) return 0; if (an) return 1; if (bn) return -1; // nulls last
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return sorted.map((r) => ({ ...r, departure: { time: r.depTime } }));
  }, [rows, query, sortKey, sortDir]);

  // When searching, show ALL matches across every date (bypass the date-range
  // filter); otherwise show the date-filtered set from FlightsFilterBar.
  const searching = query.trim().length > 0;
  const shownRows = searching ? legsForFilter : visible;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 90px)' }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Quotes</h1>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '2px 0 10px' }}>
          {loading ? 'Loading…' : `${shownRows.length} shown · ${rows.length} total from LevelFlight${searching ? ' · searching all dates' : ''}`}
        </p>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search route, quote #, or tail…"
          style={{ width: '100%', maxWidth: 360, padding: '8px 12px', marginBottom: 10, fontSize: 13, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', boxSizing: 'border-box' }}
        />
        <div style={{ opacity: searching ? 0.45 : 1, pointerEvents: searching ? 'none' : 'auto' }} title={searching ? 'Date filter is bypassed while searching' : undefined}>
          <FlightsFilterBar legs={legsForFilter} onChange={setVisible} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {sel ? (
            <>
              <div style={{ display: 'flex', gap: 8, padding: 10, borderBottom: '1px solid var(--border)', flexWrap: 'wrap', alignItems: 'center' }}>
                <button onClick={downloadPdf} disabled={pdfBusy} style={{ padding: '8px 14px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>
                  {pdfBusy ? 'Generating…' : 'Download PDF'}
                </button>
                <button onClick={copyLink} style={{ padding: '8px 14px', background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Copy client link</button>
                <button onClick={() => { setEmailOpen((o) => !o); setEmailMsg(''); }} style={{ padding: '8px 14px', background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Email link</button>
                {emailOpen && (
                  <>
                    <input type="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="client@email.com"
                      style={{ padding: '7px 10px', fontSize: 13, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)' }} />
                    <input type="text" value={emailCc} onChange={(e) => setEmailCc(e.target.value)} placeholder="Cc (optional)"
                      style={{ padding: '7px 10px', fontSize: 13, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)' }} />
                    <button onClick={sendEmailLink} style={{ padding: '8px 14px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Send</button>
                  </>
                )}
                {emailMsg && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{emailMsg}</span>}
              </div>
              {previewLoading
                ? <div style={{ margin: 'auto', color: 'var(--text-secondary)' }}>Loading preview…</div>
                : <iframe title="quote" srcDoc={html} style={{ flex: 1, border: 0, background: '#0b1018' }} />}
            </>
          ) : <div style={{ margin: 'auto', color: 'var(--text-secondary)' }}>Select a quote to preview</div>}
        </div>

        <div style={{ flex: '0 0 380px', overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Sort</span>
            {[['date', 'Date'], ['quote', 'Quote #']].map(([k, label]) => (
              <button key={k} onClick={() => setSortKey(k)}
                style={{ padding: '5px 10px', fontSize: 12, borderRadius: 7, cursor: 'pointer', border: '1px solid var(--border)', background: sortKey === k ? 'var(--accent)' : 'var(--bg-card)', color: sortKey === k ? '#fff' : 'var(--text-secondary)' }}>
                {label}
              </button>
            ))}
            <button title="Ascending" onClick={() => setSortDir('asc')}
              style={{ padding: '5px 9px', fontSize: 13, borderRadius: 7, cursor: 'pointer', border: '1px solid var(--border)', background: sortDir === 'asc' ? 'var(--accent)' : 'var(--bg-card)', color: sortDir === 'asc' ? '#fff' : 'var(--text-secondary)' }}>↑</button>
            <button title="Descending" onClick={() => setSortDir('desc')}
              style={{ padding: '5px 9px', fontSize: 13, borderRadius: 7, cursor: 'pointer', border: '1px solid var(--border)', background: sortDir === 'desc' ? 'var(--accent)' : 'var(--bg-card)', color: sortDir === 'desc' ? '#fff' : 'var(--text-secondary)' }}>↓</button>
          </div>
          {shownRows.map((q) => (
            <div key={q.dispatchId} onClick={() => setSel(q.dispatchId)}
              style={{ padding: 12, marginBottom: 8, borderRadius: 10, cursor: 'pointer', border: '1px solid var(--border)', background: sel === q.dispatchId ? 'rgba(79,142,247,0.12)' : 'var(--bg-card)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontWeight: 700, color: 'var(--accent)' }}>{q.from || '—'} → {q.to || '—'}</span>
                {q.quoteNumber && <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>#{q.quoteNumber}</span>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{q.tail || '—'} · {fmtDate(q.depTime)} · {q.legs} leg{q.legs === 1 ? '' : 's'}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginTop: 4 }}>{money(q.total)}</div>
            </div>
          ))}
          {!loading && shownRows.length === 0 && <div style={{ color: 'var(--text-secondary)', fontSize: 13, padding: 8 }}>{searching ? 'No quotes match your search.' : 'No quotes match the filter.'}</div>}
        </div>
      </div>
    </div>
  );
}
