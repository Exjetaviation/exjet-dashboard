import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import FlightsFilterBar from '../components/FlightsFilterBar';
import FlightsList from '../components/FlightsList';

// Per-tail flights view. Same data sources as Aircraft.jsx — filters
// /api/levelflight/legs down to one tail, looks up model/serial from the
// FF fleet for the header subtitle.

export default function AircraftDetail() {
  const { tail: rawTail } = useParams();
  const tail = (rawTail || '').toUpperCase();
  const navigate = useNavigate();

  const { data: ffAircraft } = useApi('/api/foreflight/aircraft');
  const { data: lfLegs, loading, error } = useApi('/api/levelflight/legs');

  const fleet = Array.isArray(ffAircraft) ? ffAircraft : [];
  const match = fleet.find((ac) => (ac.aircraftRegistration || '').toUpperCase() === tail);

  const tailLegs = useMemo(() => {
    const legs = lfLegs?.legs || [];
    return legs.filter((l) => (l.dispatch?.aircraft?.tailNumber || '').toUpperCase() === tail);
  }, [lfLegs, tail]);

  const [visible, setVisible] = useState([]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
        <button
          onClick={() => navigate('/aircraft')}
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 14px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '13px' }}
        >
          ← Aircraft
        </button>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '600', color: 'var(--text-primary)' }}>
            {tail || '—'} <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>— Flights</span>
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
            {match
              ? `${match.aircraftModelCode || '—'}${match.serialNumber ? ` · serial ${match.serialNumber}` : ''}`
              : 'aircraft details not found in fleet'}
            {' · '}
            {tailLegs.length} total{visible.length !== tailLegs.length ? ` · ${visible.length} shown` : ''}
          </p>
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '12px 16px', color: 'var(--danger)', marginBottom: '16px' }}>
          Error loading flights: {error}
        </div>
      )}

      <FlightsFilterBar legs={tailLegs} onChange={setVisible} />
      <FlightsList legs={visible} loading={loading} hideColumns={new Set(['aircraft'])} />
    </div>
  );
}
