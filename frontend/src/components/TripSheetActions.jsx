// frontend/src/components/TripSheetActions.jsx
// Reusable crew Trip Sheet actions: View (authed fetch -> modal iframe) + Download PDF.
// Used by FlightDetail and the Trips views. Returns null when there's no dispatch id.
import { useState } from 'react';
import { apiFetch } from '../lib/api';

export default function TripSheetActions({ dispatchId, tripId, compact = false }) {
  const [html, setHtml] = useState(null); // modal open when non-null
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!dispatchId) return null;

  const fail = (r) => setErr(r.status === 404 ? 'Trip sheet not available for this trip yet.' : `Failed (HTTP ${r.status})`);

  const view = async () => {
    setBusy(true); setErr('');
    try {
      const r = await apiFetch(`/api/tripsheet/${dispatchId}`);
      if (!r.ok) return fail(r);
      setHtml(await r.text());
    } catch { setErr('Trip sheet unavailable (network error).'); }
    finally { setBusy(false); }
  };

  const downloadPdf = async () => {
    setBusy(true); setErr('');
    try {
      const r = await apiFetch(`/api/tripsheet/${dispatchId}/pdf`);
      if (!r.ok) return fail(r);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `Trip Sheet ${tripId || dispatchId}.pdf`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch { setErr('Trip sheet PDF failed (network error).'); }
    finally { setBusy(false); }
  };

  const pad = compact ? '5px 10px' : '6px 12px';
  return (
    <>
      <button onClick={view} disabled={busy}
        style={{ padding: pad, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', cursor: 'pointer' }}>
        {busy ? 'Loading…' : 'Trip sheet'}
      </button>
      <button onClick={downloadPdf} disabled={busy}
        style={{ padding: pad, background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px', cursor: 'pointer' }}>
        Trip sheet PDF
      </button>
      {err && <span style={{ fontSize: '12px', color: 'var(--danger, #e5484d)' }}>{err}</span>}
      {html !== null && (
        <div onClick={() => setHtml(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', flexDirection: 'column', padding: '24px' }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: '10px', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', maxWidth: '900px', width: '100%', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #ddd', background: '#f5f5f5' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#222' }}>Trip Sheet{tripId ? ` — Trip #${tripId}` : ''}</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={downloadPdf} disabled={busy} style={{ padding: '6px 12px', background: '#1a2436', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>Download PDF</button>
                <button onClick={() => setHtml(null)} style={{ padding: '6px 12px', background: '#fff', color: '#222', border: '1px solid #ccc', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>Close</button>
              </div>
            </div>
            <iframe title="trip-sheet" srcDoc={html} style={{ flex: 1, border: 0, background: '#fff' }} />
          </div>
        </div>
      )}
    </>
  );
}
