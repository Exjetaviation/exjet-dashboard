import { useApi } from '../hooks/useApi';

export default function Aircraft() {
  const { data: ffAircraft, loading } = useApi('/api/foreflight/aircraft');
  const { data: lfLegs } = useApi('/api/levelflight/legs');

  const fleet = Array.isArray(ffAircraft) ? ffAircraft : [];
  const legs = lfLegs?.legs || [];

  const getLastFlight = (tailNumber) => {
    const matching = legs
      .filter(l => l.dispatch?.aircraft?.tailNumber === tailNumber && l.status === 3)
      .sort((a, b) => (b.arrival?.time || 0) - (a.arrival?.time || 0));
    return matching[0] || null;
  };

  const getNextFlight = (tailNumber) => {
    const now = Date.now();
    const matching = legs
      .filter(l => l.dispatch?.aircraft?.tailNumber === tailNumber && l.departure?.time > now)
      .sort((a, b) => (a.departure?.time || 0) - (b.departure?.time || 0));
    return matching[0] || null;
  };

  const formatDate = (ms) => {
    if (!ms) return '—';
    return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div>
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: '600', color: 'var(--text-primary)' }}>Aircraft</h1>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px' }}>
          {loading ? 'Loading...' : `${fleet.length} aircraft in fleet`}
        </p>
      </div>

      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading fleet...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {fleet.map((ac, i) => {
            const last = getLastFlight(ac.aircraftRegistration);
            const next = getNextFlight(ac.aircraftRegistration);
            return (
              <div key={i} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ fontSize: '28px' }}>🛩</div>
                    <div>
                      <h2 style={{ fontSize: '20px', fontWeight: '600', color: 'var(--accent)' }}>{ac.aircraftRegistration}</h2>
                      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        {ac.aircraftModelCode} · {ac.fuelType} · {ac.weightUnit}
                      </p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {ac.aircraftLicenses?.map((lic, j) => (
                      <span key={j} style={{
                        background: 'rgba(79,142,247,0.15)',
                        color: 'var(--accent)',
                        border: '1px solid rgba(79,142,247,0.3)',
                        borderRadius: '20px', padding: '4px 12px', fontSize: '12px', fontWeight: '500'
                      }}>{lic}</span>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0', }}>
                  <div style={{ padding: '20px 24px', borderRight: '1px solid var(--border)' }}>
                    <p style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>Last Flight</p>
                    {last ? (
                      <>
                        <p style={{ fontSize: '16px', fontWeight: '500', color: 'var(--text-primary)' }}>
                          {last.departure?.airport} → {last.arrival?.airport}
                        </p>
                        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>{formatDate(last.arrival?.time)}</p>
                        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                          {last._calc?.time} · {last._calc?.distance?.value} nm
                        </p>
                      </>
                    ) : (
                      <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>No completed flights this month</p>
                    )}
                  </div>

                  <div style={{ padding: '20px 24px' }}>
                    <p style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>Next Flight</p>
                    {next ? (
                      <>
                        <p style={{ fontSize: '16px', fontWeight: '500', color: 'var(--text-primary)' }}>
                          {next.departure?.airport} → {next.arrival?.airport}
                        </p>
                        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>{formatDate(next.departure?.time)}</p>
                        <p style={{ fontSize: '13px', color: 'var(--success)', marginTop: '2px' }}>
                          {next.dispatch?.client?.company?.name || 'No client assigned'}
                        </p>
                      </>
                    ) : (
                      <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>No upcoming flights scheduled</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
