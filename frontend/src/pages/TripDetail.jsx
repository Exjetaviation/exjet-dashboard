// frontend/src/pages/TripDetail.jsx
// Dashboard trip page: header + multi-leg flight-path map + legs list + actions.
// Receives the trip via router state; on a cold load it refetches legs and regroups.
import { useEffect, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { apiFetch, API_BASE } from '../lib/api';
import { groupLegsIntoTrips } from '../lib/trips';
import FlightsList from '../components/FlightsList';
import TripPathMap from '../components/TripPathMap';
import TripSheetActions from '../components/TripSheetActions';

const STATUS_MAP = { 0: { label: 'Scheduled', color: '#4f8ef7' }, 1: { label: 'Active', color: '#f59e0b' }, 2: { label: 'Booked', color: '#a855f7' }, 3: { label: 'Completed', color: '#22c55e' } };
const fmtDate = (ms) => (ms && Number.isFinite(ms) ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const range = (a, b) => (fmtDate(a) === fmtDate(b) ? fmtDate(a) : `${fmtDate(a)} – ${fmtDate(b)}`);
const HIDE = new Set(['aircraft']);

export default function TripDetail() {
  const { id } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();
  const [trip, setTrip] = useState(state?.trip && state.trip.dispatchId === id ? state.trip : null);
  const [loading, setLoading] = useState(!trip);

  useEffect(() => {
    if (trip) return;
    let on = true;
    (async () => {
      try {
        const r = await apiFetch('/api/levelflight/legs');
        const j = await r.json();
        const found = groupLegsIntoTrips(j.legs || []).find((t) => t.dispatchId === id);
        if (on) { setTrip(found || null); setLoading(false); }
      } catch { if (on) setLoading(false); }
    })();
    return () => { on = false; };
  }, [id, trip]);

  if (loading) return <div style={{ padding: 40, color: 'var(--text-secondary)' }}>Loading trip…</div>;
  if (!trip) return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
      <p>Trip not found.</p>
      <button onClick={() => navigate('/flights?view=trips')} style={{ marginTop: 16, padding: '8px 20px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Back to Trips</button>
    </div>
  );

  const s = STATUS_MAP[trip.status] || { label: '—', color: '#888' };
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/flights?view=trips')} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13 }}>← Trips</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: 'var(--text-primary)' }}>{trip.routeSummary || 'Trip'}</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
            {trip.tripId ? `Trip #${trip.tripId} · ` : ''}{range(trip.start, trip.end)} · {trip.tail || '—'} · {trip.legCount} leg{trip.legCount === 1 ? '' : 's'}{trip.client ? ` · ${trip.client}` : ''}
            <span style={{ marginLeft: 10, background: `${s.color}22`, color: s.color, border: `1px solid ${s.color}44`, borderRadius: 20, padding: '2px 9px', fontSize: 11 }}>{s.label}</span>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <a href={`${API_BASE}/itinerary/${trip.dispatchId}`} target="_blank" rel="noopener noreferrer"
            style={{ padding: '6px 12px', background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, textDecoration: 'none' }}>Itinerary ↗</a>
          <TripSheetActions dispatchId={trip.dispatchId} tripId={trip.tripId} />
        </div>
      </div>

      <TripPathMap legs={trip.legs} />
      <FlightsList legs={trip.legs} hideColumns={HIDE} />
    </div>
  );
}
