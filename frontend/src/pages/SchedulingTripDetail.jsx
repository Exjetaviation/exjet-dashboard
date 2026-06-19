import { useEffect, useState, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import FlightsList from '../components/FlightsList';
import TripSheetActions from '../components/TripSheetActions';

// Workflow action buttons — each advances the trip's status. "Release" also makes
// the Crew Trip Sheet available (LevelFlight's Release-Legs behavior).
const ACTIONS = [
  { label: 'Book', status: 'booked', color: '#a855f7' },
  { label: 'Release', status: 'released', color: '#3b82f6' },
  { label: 'Close', status: 'closed', color: '#22c55e' },
  { label: 'Cancel', status: 'cancelled', color: '#ef4444' },
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

  const setStatus = async (status) => {
    setBusy(true); setError(null);
    try {
      const r = await apiFetch(`/api/scheduling/trips/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
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
  const tail = stateTrip?.tail || legsForView[0]?.dispatch?.aircraft?.tailNumber || null;
  const client = stateTrip?.client || legsForView[0]?.dispatch?.client?.company?.name || null;
  const airports = legsForView.length
    ? legsForView.flatMap((l, i) => (i === 0 ? [l.departure?.airport, l.arrival?.airport] : [l.arrival?.airport])).filter(Boolean)
    : [];
  const routeSummary = stateTrip?.routeSummary || (airports.length ? airports.join(' → ') : null);
  const title = routeSummary || (meta?.trip_number ? `Trip #${meta.trip_number}` : 'Trip');
  const subtitle = [meta?.trip_number ? `Trip #${meta.trip_number}` : null, tail, client].filter(Boolean).join(' · ');
  const released = meta?.status === 'released';

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

      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Status</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 20, padding: '4px 12px' }}>
            {meta?.status_label || '—'}
          </span>
          {meta?.locally_modified && meta?.origin === 'levelflight' && (
            <>
              <span style={{ fontSize: 12, color: '#f59e0b', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 20, padding: '3px 10px' }}>
                Edited locally · LevelFlight: {meta.original_status_label}
              </span>
              <button onClick={revert} disabled={busy}
                style={{ padding: '6px 12px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>⟲ Revert to LevelFlight</button>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {ACTIONS.map((a) => {
            const active = meta?.status === a.status;
            return (
              <button key={a.status} onClick={() => setStatus(a.status)} disabled={busy || !meta}
                style={{ padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
                  background: active ? a.color : 'var(--bg-secondary)',
                  color: active ? '#fff' : 'var(--text-primary)',
                  border: `1px solid ${active ? a.color : 'var(--border)'}`, borderRadius: 8, opacity: busy ? 0.6 : 1 }}>
                {a.label}
              </button>
            );
          })}
          {released && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 6, paddingLeft: 12, borderLeft: '1px solid var(--border)' }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Crew Trip Sheet:</span>
              <TripSheetActions dispatchId={id} tripId={meta?.trip_number} compact />
            </div>
          )}
        </div>
      </div>

      {legsForView.length ? <FlightsList legs={legsForView} hideColumns={HIDE} /> : (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No legs found for this trip.</p>
      )}
    </div>
  );
}
