import { useNavigate } from 'react-router-dom';
import StatCard from '../components/StatCard';
import { useApi } from '../hooks/useApi';

const fmtDate = (ms) => {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
const fmtTime = (ms) => {
  if (!ms) return '—';
  return new Date(ms).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
};

export default function Overview() {
  const { data: ffAircraft } = useApi('/api/foreflight/aircraft');
  const { data: ffCrew } = useApi('/api/foreflight/crew');
  const { data: lfLegs } = useApi('/api/levelflight/legs');
  const navigate = useNavigate();

  const aircraftCount = Array.isArray(ffAircraft) ? ffAircraft.length : '—';
  const crewCount = Array.isArray(ffCrew) ? ffCrew.length : '—';
  const legCount = lfLegs?.legs ? lfLegs.legs.length : '—';

  const fleet = Array.isArray(ffAircraft) ? ffAircraft : [];
  const legs = lfLegs?.legs || [];

  // The next upcoming leg per tail (or null). One pass: track the
  // earliest future leg seen for each aircraft.
  const now = Date.now();
  const nextByTail = new Map();
  for (const tail of fleet.map((a) => a.aircraftRegistration)) {
    nextByTail.set(tail, null);
  }
  for (const leg of legs) {
    const tail = leg.dispatch?.aircraft?.tailNumber;
    if (!tail || !nextByTail.has(tail)) continue;
    const t = leg.departure?.time;
    if (!t || t <= now) continue;
    const current = nextByTail.get(tail);
    if (!current || t < (current.departure?.time || Infinity)) nextByTail.set(tail, leg);
  }

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

      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '24px', marginBottom: '24px' }}>
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

      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: '500' }}>Upcoming Flights</h2>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            Next flight per aircraft · click a row for details
          </span>
        </div>

        {fleet.length === 0 ? (
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Loading fleet…</p>
        ) : (
          <div style={{ border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden' }}>
            {fleet.map((ac, i) => {
              const tail = ac.aircraftRegistration;
              const next = nextByTail.get(tail);
              const hasFlight = !!next;
              const targetHref = hasFlight ? `/flights/${next._id?.$oid}` : `/aircraft/${encodeURIComponent(tail)}`;
              const onClick = () => {
                if (hasFlight) navigate(targetHref, { state: { leg: next } });
                else navigate(targetHref);
              };
              return (
                <div
                  key={tail}
                  onClick={onClick}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(79,142,247,0.06)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '160px 160px 1fr 1fr',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '12px 18px',
                    cursor: 'pointer',
                    transition: 'background 0.1s',
                    fontSize: '13px',
                    borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                    <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--accent)' }}>{tail}</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      {ac.aircraftModelCode || '—'}
                    </span>
                  </div>

                  {hasFlight ? (
                    <>
                      <div>
                        <div style={{ color: 'var(--text-primary)' }}>{fmtDate(next.departure?.time)}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                          {fmtTime(next.departure?.time)}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{next.departure?.airport || '—'}</span>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>✈</span>
                        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{next.arrival?.airport || '—'}</span>
                      </div>
                      <div style={{ color: 'var(--text-secondary)', textAlign: 'right' }}>
                        {next.dispatch?.client?.company?.name || '—'}
                      </div>
                    </>
                  ) : (
                    <div style={{ gridColumn: '2 / -1', color: 'var(--text-secondary)' }}>
                      No upcoming flights scheduled.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
