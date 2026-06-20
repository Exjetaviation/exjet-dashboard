import { useApi } from '../../hooks/useApi';
import { overviewStats } from '../../lib/schedulingAggregate';

// Scheduling ops overview — stat tiles (click to jump to that section) + the next
// departures. All derived client-side from /api/scheduling/legs.
const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 };
const fmt = (t) => (t ? new Date(t).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

export default function SchedulingOverview({ onJump }) {
  const { data, loading, error } = useApi('/api/scheduling/legs');
  const legs = data?.legs || [];
  const s = overviewStats(legs);
  const tiles = [
    { label: 'Trips', value: s.tripCount, to: 'trips' },
    { label: 'Flights (legs)', value: s.legCount, to: 'schedule' },
    { label: 'Aircraft', value: s.aircraftCount, to: 'aircraft' },
    { label: 'Clients', value: s.clientCount, to: 'clients' },
    { label: 'Crew', value: s.crewCount, to: 'crew' },
    { label: 'Departing today', value: s.flightsToday, to: 'schedule' },
  ];

  if (error) return <div style={{ ...card, color: 'var(--danger)' }}>Error loading overview: {error}</div>;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
        {tiles.map((t) => (
          <div key={t.label} onClick={() => onJump?.(t.to)}
            style={{ ...card, cursor: 'pointer' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)' }}>{loading ? '—' : t.value}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{t.label}</div>
          </div>
        ))}
      </div>

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>Next departures</div>
        {loading ? (
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Loading…</p>
        ) : s.upcoming.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Nothing scheduled ahead.</p>
        ) : s.upcoming.map((l, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderTop: i ? '1px solid var(--border)' : 'none', fontSize: 13, flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{l.departure?.airport} → {l.arrival?.airport}</span>
            <span style={{ color: 'var(--text-secondary)' }}>{l.dispatch?.aircraft?.tailNumber || '—'} · {l.dispatch?.client?.company?.name || '—'} · {fmt(l.departure?.time)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
