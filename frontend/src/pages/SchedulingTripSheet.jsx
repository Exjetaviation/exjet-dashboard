import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';

// Login-only web trip sheet: a full-page SPA route (behind RequireAuth) that fetches
// the authenticated trip-sheet HTML with the user's token and renders it in an iframe.
// Opens in a new tab like the passenger itinerary, but never exposes crew/mx data
// without a login.
export default function SchedulingTripSheet() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [html, setHtml] = useState(null);
  const [error, setError] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await apiFetch(`/api/scheduling/trips/${id}`); // resolve trip exists / 404 fast
        if (!r.ok && r.status === 404) { if (alive) setError('Trip not found'); return; }
        const tr = await apiFetch(`/api/tripsheet/${id}`);
        const text = await tr.text();
        if (!alive) return;
        if (!tr.ok) { setError(text || 'Trip sheet not available for this trip yet'); return; }
        setHtml(text);
      } catch (e) { if (alive) setError(e.message); }
    })();
    return () => { alive = false; };
  }, [id]);

  const downloadPdf = async () => {
    setPdfBusy(true);
    try {
      const r = await apiFetch(`/api/tripsheet/${id}/pdf`);
      if (!r.ok) throw new Error(`PDF failed (${r.status})`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { setError(e.message); }
    setPdfBusy(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg-primary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <button onClick={() => navigate(`/scheduling/trips/${id}`)}
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 13px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13 }}>← Trip</button>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Crew Trip Sheet</span>
        <button onClick={downloadPdf} disabled={pdfBusy || !html}
          style={{ marginLeft: 'auto', padding: '7px 14px', fontSize: 13, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: pdfBusy ? 'default' : 'pointer', opacity: pdfBusy ? 0.6 : 1 }}>
          {pdfBusy ? 'Preparing…' : '↓ Download PDF'}
        </button>
      </div>
      {error ? (
        <div style={{ padding: 24, color: 'var(--danger)', fontSize: 14 }}>{error}</div>
      ) : html == null ? (
        <div style={{ padding: 24, color: 'var(--text-secondary)', fontSize: 14 }}>Loading trip sheet…</div>
      ) : (
        <iframe srcDoc={html} title="Crew Trip Sheet" style={{ flex: 1, width: '100%', border: 'none' }} />
      )}
    </div>
  );
}
