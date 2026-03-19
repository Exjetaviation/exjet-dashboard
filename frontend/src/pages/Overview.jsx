import StatCard from '../components/StatCard';
import { useApi } from '../hooks/useApi';

export default function Overview() {
  const { data: ffAircraft } = useApi('/api/foreflight/aircraft');
  const { data: ffCrew } = useApi('/api/foreflight/crew');
  const { data: lfLegs } = useApi('/api/levelflight/legs');

  const aircraftCount = Array.isArray(ffAircraft) ? ffAircraft.length : '—';
  const crewCount = Array.isArray(ffCrew) ? ffCrew.length : '—';
  const legCount = lfLegs?.legs ? lfLegs.legs.length : '—';

  return (
    <div>
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: '600', color: 'var(--text-primary)' }}>Operations Overview</h1>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px' }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '32px' }}>
        <StatCard label="Aircraft" value={aircraftCount} sub="In fleet" color="var(--accent)" />
        <StatCard label="Crew" value={crewCount} sub="Active members" color="var(--success)" />
        <StatCard label="Legs This Month" value={legCount} sub="LevelFlight scheduled" color="#a855f7" />
      </div>

      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '24px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: '500', marginBottom: '16px' }}>System Status</h2>
        <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
          {[
            { label: 'ForeFlight', ok: !!ffAircraft },
            { label: 'LevelFlight', ok: !!lfLegs },
          ].map(({ label, ok }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: ok ? 'var(--success)' : 'var(--danger)', display: 'inline-block' }} />
              <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
              <span style={{ color: ok ? 'var(--success)' : 'var(--danger)' }}>{ok ? 'Connected' : 'Error'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
