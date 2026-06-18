import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import FlightsFilterBar from '../components/FlightsFilterBar';
import FlightsList from '../components/FlightsList';
import TripsList from '../components/TripsList';

export default function Flights() {
  const { data, loading, error } = useApi('/api/levelflight/legs');
  const legs = data?.legs || [];
  const [visible, setVisible] = useState([]);
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'trips' ? 'trips' : 'legs';
  const setView = (v) => setParams((p) => { const n = new URLSearchParams(p); v === 'trips' ? n.set('view', 'trips') : n.delete('view'); return n; }, { replace: true });

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
        <h1 style={{ fontSize: '24px', fontWeight: '600', color: 'var(--text-primary)' }}>Flights</h1>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px' }}>
          {loading ? 'Loading...' : `${legs.length} legs · ${visible.length} shown`}
        </p>
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
        <Tab id="legs" label="Legs" />
        <Tab id="trips" label="Trips" />
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '12px 16px', color: 'var(--danger)', marginBottom: '16px' }}>
          Error loading flights: {error}
        </div>
      )}

      <FlightsFilterBar legs={legs} onChange={setVisible} />
      {view === 'trips'
        ? <TripsList legs={visible} loading={loading} />
        : <FlightsList legs={visible} loading={loading} />}
    </div>
  );
}
