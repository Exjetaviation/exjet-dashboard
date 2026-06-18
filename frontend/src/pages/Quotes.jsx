import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

const fmtDate = (ms) => ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const money = (n) => n == null ? '—' : '$' + Number(n).toLocaleString('en-US');

export default function Quotes() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(null);
  const [html, setHtml] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

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

  return (
    <div style={{ display: 'flex', gap: 16, height: 'calc(100vh - 90px)' }}>
      <div style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {sel ? (
          <>
            <div style={{ display: 'flex', gap: 8, padding: 10, borderBottom: '1px solid var(--border)' }}>
              <button onClick={downloadPdf} disabled={pdfBusy} style={{ padding: '8px 14px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>
                {pdfBusy ? 'Generating…' : 'Download PDF'}
              </button>
            </div>
            {previewLoading
              ? <div style={{ margin: 'auto', color: 'var(--text-secondary)' }}>Loading preview…</div>
              : <iframe title="quote" srcDoc={html} style={{ flex: 1, border: 0, background: '#0b1018' }} />}
          </>
        ) : <div style={{ margin: 'auto', color: 'var(--text-secondary)' }}>Select a quote to preview</div>}
      </div>
      <div style={{ flex: '0 0 380px', overflowY: 'auto' }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Quotes</h1>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{loading ? 'Loading…' : `${rows.length} from LevelFlight`}</p>
        {rows.map((q) => (
          <div key={q.dispatchId} onClick={() => setSel(q.dispatchId)}
            style={{ padding: 12, marginTop: 8, borderRadius: 10, cursor: 'pointer', border: '1px solid var(--border)', background: sel === q.dispatchId ? 'rgba(79,142,247,0.12)' : 'var(--bg-card)' }}>
            <div style={{ fontWeight: 700, color: 'var(--accent)' }}>{q.from || '—'} → {q.to || '—'}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{q.tail || '—'} · {fmtDate(q.depTime)} · {q.legs} leg{q.legs === 1 ? '' : 's'}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginTop: 4 }}>{money(q.total)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
