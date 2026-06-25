import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';

const FLEET = ['N408JS', 'N69FP'];

// Creating a quote makes a draft scheduling_trips row immediately (so it has a
// Quote # to autosave into), then drops the user into the QuoteEditor.
export default function NewQuoteRedirect() {
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      try {
        const r = await apiFetch('/api/scheduling/trips', {
          method: 'POST',
          body: JSON.stringify({ aircraft_tail: FLEET[0], purpose: 'charter', legs: [{ dep_icao: '', arr_icao: '' }] }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || `Create failed (${r.status})`);
        navigate(`/scheduling/quotes/${j.trip.quote_number}`, { replace: true });
      } catch (e) { setError(e.message); }
    })();
  }, [navigate]);

  if (error) return (
    <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '12px 16px', color: 'var(--danger)' }}>{error}</div>
  );
  return <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Creating quote…</p>;
}
