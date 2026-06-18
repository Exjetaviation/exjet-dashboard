import { useEffect, useState, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import FlightsList from '../components/FlightsList';

// Dispatch status options a dispatcher can set (must match the backend enum).
const STATUS_OPTIONS = [
  { code: 0, label: 'Booked', color: '#a855f7' },
  { code: 4, label: 'In Progress', color: '#f59e0b' },
  { code: 2, label: 'Closed', color: '#22c55e' },
];
const HIDE = new Set(['aircraft']);

export default function SchedulingTripDetail() {
  const { id } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();
  const stateTrip = state?.trip && state.trip.dispatchId === id ? state.trip : null; // fast-path hydration
  const [meta, setMeta] = useState(null);   // status + provenance from the backend
  const [legs, setLegs] = useState([]);     // legs from the mirror (survives refresh)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/scheduling/trips/${id}`);
      const j = await r.json();
      if (j.trip) { setMeta(j.trip); setLegs(j.legs || []); }
      else setError(j.error || 'Trip not found');
    } catch (e) { setError(e.message); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (code) => {
    setBusy(true); setError(null);
    try {
      const r = await apiFetch(`/api/scheduling/trips/${id}`, { method: 'PATCH', body: JSON.stringify({ status: Number(code) }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `Update failed (${r.status})`); }
      await load();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const revert = async () => {
    setBusy(true); setError(null);
    try {
      const r = await apiFetch(`/api/scheduling/trips/${id}/revert`, { method: 'POST' });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `Revert failed (${r.status})`); }
      await load();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  // Legs: prefer the mirror response; fall back to router state during the first paint.
  const legsForView = legs.length ? legs : (stateTrip?.legs || []);
  // Header: use router state when present, else derive from the legs.
  const tail = stateTrip?.tail || legsForView[0]?.dispatch?.aircraft?.tailNumber || null;
  const client = stateTrip?.client || legsForView[0]?.dispatch?.client?.company?.name || null;
  const airports = legsForView.length
    ? legsForView.flatMap((l, i) => (i === 0 ? [l.departure?.airport, l.arrival?.airport] : [l.arrival?.airport])).filter(Boolean)
    : [];
  const routeSummary = stateTrip?.routeSummary || (airports.length ? airports.join(' → ') : null);
  const title = routeSummary || (meta?.trip_number ? `Trip #${meta.trip_number}` : 'Trip');
  const subtitle = [meta?.trip_number ? `Trip #${meta.trip_number}` : null, tail, client].filter(Boolean).join(' · ');

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/scheduling')}
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13 }}>← Scheduling</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{subtitle}</p>
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '12px 16px', color: 'var(--danger)', marginBottom: 16 }}>{error}</div>
      )}

      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Status</label>
        <select value={meta?.status ?? ''} disabled={busy || !meta} onChange={(e) => setStatus(e.target.value)}
          style={{ padding: '8px 12px', fontSize: 13, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8 }}>
          {STATUS_OPTIONS.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
        {meta?.locally_modified && (
          <>
            <span style={{ fontSize: 12, color: '#f59e0b', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 20, padding: '3px 10px' }}>
              Edited locally · LevelFlight: {meta.original_status_label}
            </span>
            <button onClick={revert} disabled={busy}
              style={{ padding: '6px 12px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>⟲ Revert to LevelFlight</button>
          </>
        )}
      </div>

      {legsForView.length ? <FlightsList legs={legsForView} hideColumns={HIDE} /> : (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No legs found for this trip.</p>
      )}
    </div>
  );
}
