import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import FlightsFilterBar from '../components/FlightsFilterBar';
import FlightsList from '../components/FlightsList';

export default function Flights() {
  const { data, loading, error } = useApi('/api/levelflight/legs');
  const legs = data?.legs || [];
  const [visible, setVisible] = useState([]);

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: '600', color: 'var(--text-primary)' }}>Flights</h1>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px' }}>
          {loading ? 'Loading...' : `${legs.length} total · ${visible.length} shown · click a column to sort · click a row for details`}
        </p>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '12px 16px', color: 'var(--danger)', marginBottom: '16px' }}>
          Error loading flights: {error}
        </div>
      )}

      <FlightsFilterBar legs={legs} onChange={setVisible} />
      <FlightsList legs={visible} loading={loading} />
    </div>
  );
}
