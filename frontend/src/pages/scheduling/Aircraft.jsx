import { useApi } from '../../hooks/useApi';
import { distinctAircraft } from '../../lib/schedulingAggregate';

// Fleet derived from the mirror legs (distinct tails + their trip/leg counts).
const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 };

export default function SchedulingAircraft() {
  const { data, loading, error } = useApi('/api/scheduling/legs');
  const aircraft = distinctAircraft(data?.legs || []);

  if (error) return <div style={{ ...card, color: 'var(--danger)' }}>Error loading aircraft: {error}</div>;
  if (loading) return <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Loading fleet…</p>;
  if (!aircraft.length) return <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No aircraft in the mirror.</p>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
      {aircraft.map((a) => (
        <div key={a.tail} style={card}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)' }}>{a.tail}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            {a.type || '—'}{a.paxSeats != null ? ` · ${a.paxSeats} seats` : ''}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
            {a.tripCount} trip{a.tripCount === 1 ? '' : 's'} · {a.legCount} leg{a.legCount === 1 ? '' : 's'}
          </div>
        </div>
      ))}
    </div>
  );
}
