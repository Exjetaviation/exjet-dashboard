import { useNavigate } from 'react-router-dom';
import StatCard from '../components/StatCard';
import { useApi } from '../hooks/useApi';

const UPCOMING_PER_AIRCRAFT = 5;

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

  // Group upcoming legs by tail, sort each group by departure time, then
  // slice to the per-aircraft cap. We sort once at construction; the
  // render path just maps the pre-built lists.
  const now = Date.now();
  const upcomingByTail = new Map();
  for (const tail of fleet.map((a) => a.aircraftRegistration)) {
    upcomingByTail.set(tail, []);
  }
  for (const leg of legs) {
    const tail = leg.dispatch?.aircraft?.tailNumber;
    if (!tail || !upcomingByTail.has(tail)) continue;
    if (!leg.departure?.time || leg.departure.time <= now) continue;
    upcomingByTail.get(tail).push(leg);
  }
  for (const arr of upcomingByTail.values()) {
    arr.sort((a, b) => (a.departure?.time || 0) - (b.departure?.time || 0));
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
          <h2 style={{ fontSize: '16px', fontWeight: '500' }}>Upcoming Flights by Aircraft</h2>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            Next {UPCOMING_PER_AIRCRAFT} per tail · click a row for details
          </span>
        </div>

        {fleet.length === 0 ? (
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Loading fleet…</p>
        ) : (
          <div style={{ display: 'grid', gap: '16px' }}>
            {fleet.map((ac) => {
              const tail = ac.aircraftRegistration;
              const upcoming = (upcomingByTail.get(tail) || []).slice(0, UPCOMING_PER_AIRCRAFT);
              return (
                <div key={tail} style={{ border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden' }}>
                  <div
                    onClick={() => navigate(`/aircraft/${encodeURIComponent(tail)}`)}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(79,142,247,0.06)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '12px 18px', cursor: 'pointer',
                      background: 'rgba(255,255,255,0.02)',
                      borderBottom: '1px solid var(--border)',
                      transition: 'background 0.1s',
                    }}
                    title={`Open ${tail} flights`}
                  >
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
                      <span style={{ fontSize: '16px', fontWeight: 600, color: 'var(--accent)' }}>{tail}</span>
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        {ac.aircraftModelCode || '—'}
                      </span>
                    </div>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {upcoming.length} upcoming
                    </span>
                  </div>

                  {upcoming.length === 0 ? (
                    <div style={{ padding: '16px 18px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                      No upcoming flights scheduled.
                    </div>
                  ) : (
                    <div>
                      {upcoming.map((leg) => {
                        const id = leg._id?.$oid;
                        const from = leg.departure?.airport || '—';
                        const to = leg.arrival?.airport || '—';
                        const client = leg.dispatch?.client?.company?.name || '';
                        return (
                          <div
                            key={id}
                            onClick={() => navigate(`/flights/${id}`, { state: { leg } })}
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(79,142,247,0.06)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '160px 1fr 1fr',
                              alignItems: 'center',
                              gap: '12px',
                              padding: '10px 18px',
                              borderTop: '1px solid var(--border)',
                              cursor: 'pointer',
                              transition: 'background 0.1s',
                              fontSize: '13px',
                            }}
                          >
                            <div>
                              <div style={{ color: 'var(--text-primary)' }}>{fmtDate(leg.departure?.time)}</div>
                              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                {fmtTime(leg.departure?.time)}
                              </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{from}</span>
                              <span style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>✈</span>
                              <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{to}</span>
                            </div>
                            <div style={{ color: 'var(--text-secondary)', textAlign: 'right' }}>
                              {client || '—'}
                            </div>
                          </div>
                        );
                      })}
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
