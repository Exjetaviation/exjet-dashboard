import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import FlightsFilterBar from '../components/FlightsFilterBar';
import FlightsList from '../components/FlightsList';
import TripsList from '../components/TripsList';

// Reads the new scheduling MIRROR (scheduling_legs snapshots) rather than a live
// LevelFlight call. Reuses the existing list components unchanged.
export default function Scheduling() {
  const { data, loading, error } = useApi('/api/scheduling/legs');
  const legs = data?.legs || [];
  const [visible, setVisible] = useState([]);
  const [query, setQuery] = useState('');
  const [params, setParams] = useSearchParams();

  const q = query.trim().toLowerCase();
  const shown = q
    ? visible.filter((leg) => [
        leg.departure?.airport, leg.arrival?.airport,
        leg.dispatch?.aircraft?.tailNumber,
        leg.dispatch?.client?.company?.name,
        leg.dispatch?.tripId,
      ].some((v) => String(v ?? '').toLowerCase().includes(q)))
    : visible;
  const view = params.get('view') === 'legs' ? 'legs' : 'trips';
  const setView = (v) => setParams((p) => { const n = new URLSearchParams(p); v === 'legs' ? n.set('view', 'legs') : n.delete('view'); return n; }, { replace: true });

  const Tab = ({ id, label }) => (
    <button onClick={() => setView(id)}
      style={{ padding: '8px 18px', fontSize: 13, fontWeight: 500, cursor: 'pointer', background: 'none', border: 'none',
        color: view === id ? 'var(--accent)' : 'var(--text-secondary)',
        borderBottom: view === id ? '2px solid var(--accent)' : '2px solid transparent' }}>
      {label}
    </button>
  );

  return (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: '600', color: 'var(--text-primary)' }}>Scheduling</h1>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px' }}>
          {loading ? 'Loading from mirror...' : `${legs.length} legs · ${shown.length} shown · synced from LevelFlight`}
        </p>
      </div>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search route, tail, client, or trip #…"
        style={{ width: '100%', maxWidth: 360, padding: '8px 12px', marginBottom: 12, fontSize: 13, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', boxSizing: 'border-box' }}
      />

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
        <Tab id="trips" label="Trips" />
        <Tab id="legs" label="Legs" />
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '12px 16px', color: 'var(--danger)', marginBottom: '16px' }}>
          Error loading scheduling: {error}
        </div>
      )}

      <FlightsFilterBar legs={legs} onChange={setVisible} />
      {view === 'legs'
        ? <FlightsList legs={shown} loading={loading} />
        : <TripsList legs={shown} loading={loading} />}
    </div>
  );
}
