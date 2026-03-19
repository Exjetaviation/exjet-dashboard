import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const Section = ({ title, children }) => (
  <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden', marginBottom: '20px' }}>
    <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
      <h2 style={{ fontSize: '14px', fontWeight: '500', color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</h2>
    </div>
    <div style={{ padding: '20px' }}>{children}</div>
  </div>
);

const Field = ({ label, value, accent }) => (
  <div style={{ marginBottom: '14px' }}>
    <p style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>{label}</p>
    <p style={{ fontSize: '14px', color: accent ? 'var(--accent)' : 'var(--text-primary)', fontWeight: accent ? '500' : '400' }}>{value || '—'}</p>
  </div>
);

const CheckItem = ({ label, value }) => {
  const status = value === 1 ? 'complete' : value === -1 ? 'pending' : 'n/a';
  const color = status === 'complete' ? 'var(--success)' : status === 'pending' ? 'var(--warning)' : 'var(--text-secondary)';
  const icon = status === 'complete' ? '✓' : status === 'pending' ? '○' : '—';
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: '13px', color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{label.replace(/([A-Z])/g, ' $1')}</span>
      <span style={{ fontSize: '13px', color, fontWeight: '500' }}>{icon} {status}</span>
    </div>
  );
};

const formatDateTime = (ms) => {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
};

const formatMins = (mins) => {
  if (!mins) return '—';
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
};

export default function FlightDetail() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const { id } = useParams();

  const leg = state?.leg;

  const [ffBriefing, setFfBriefing] = useState(null);
  const [ffNavlog, setFfNavlog] = useState(null);
  const [ffWb, setFfWb] = useState(null);
  const [ffOverflight, setFfOverflight] = useState(null);
  const [ffIcao, setFfIcao] = useState(null);
  const [ffLoading, setFfLoading] = useState(false);

  const ffFlightId = leg?.foreflight?.flightId;

  useEffect(() => {
    if (!ffFlightId) return;
    setFfLoading(true);
    const endpoints = [
      { key: 'briefing', setter: setFfBriefing },
      { key: 'navlog', setter: setFfNavlog },
      { key: 'wb', setter: setFfWb },
      { key: 'overflight', setter: setFfOverflight },
      { key: 'icao', setter: setFfIcao },
    ];
    Promise.all(
      endpoints.map(({ key, setter }) =>
        fetch(`${BASE_URL}/api/foreflight/flights/${ffFlightId}/${key}`)
          .then(r => r.json())
          .then(data => setter(data))
          .catch(() => setter(null))
      )
    ).finally(() => setFfLoading(false));
  }, [ffFlightId]);

  if (!leg) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
        <p>Flight not found.</p>
        <button onClick={() => navigate('/flights')} style={{ marginTop: '16px', padding: '8px 20px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
          Back to Flights
        </button>
      </div>
    );
  }

  const checklist = leg.checklist?.trip || {};

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '28px' }}>
        <button onClick={() => navigate('/flights')} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 14px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '13px' }}>
          ← Flights
        </button>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '600', color: 'var(--text-primary)' }}>
            {leg.departure?.airport} → {leg.arrival?.airport}
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
            {leg.dispatch?.aircraft?.tailNumber} · Trip #{leg.dispatch?.tripId} · Quote #{leg.dispatch?.quoteId}
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>

        <div>
          <Section title="Flight Info">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
              <Field label="Departure" value={formatDateTime(leg.departure?.time)} />
              <Field label="Arrival" value={formatDateTime(leg.arrival?.time)} />
              <Field label="From" value={`${leg.departure?.airport} · ${leg._calc?.from?.name}`} />
              <Field label="To" value={`${leg.arrival?.airport} · ${leg._calc?.to?.name}`} />
              <Field label="Flight Time" value={leg._calc?.time} />
              <Field label="Distance" value={`${leg._calc?.distance?.value} nm · ${leg._calc?.miles?.value} mi`} />
              <Field label="Aircraft" value={leg.dispatch?.aircraft?.tailNumber} accent />
              <Field label="Type" value={leg.dispatch?.aircraft?.type?.name} />
              <Field label="Passengers" value={leg.passengerCount} />
              <Field label="Client" value={leg.dispatch?.client?.company?.name} />
            </div>
          </Section>

          <Section title="Fuel">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
              <Field label="Estimated Fuel" value={`${leg._calc?.fuel?.value?.toLocaleString()} ${leg._calc?.fuel?.unit}`} />
              <Field label="Fuel Start" value={leg.postFlight?.fuel?.start ? `${Number(leg.postFlight.fuel.start).toLocaleString()} lbs` : null} />
              <Field label="Fuel Stop" value={leg.postFlight?.fuel?.stop ? `${Number(leg.postFlight.fuel.stop).toLocaleString()} lbs` : null} />
              <Field label="Fuel Used" value={
                leg.postFlight?.fuel?.start && leg.postFlight?.fuel?.stop
                  ? `${(Number(leg.postFlight.fuel.start) - Number(leg.postFlight.fuel.stop)).toLocaleString()} lbs`
                  : null
              } />
            </div>
          </Section>

          <Section title="Block Times">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
              <Field label="Out" value={formatDateTime(leg.block?.out)} />
              <Field label="Off" value={formatDateTime(leg.block?.off)} />
              <Field label="On" value={formatDateTime(leg.block?.on)} />
              <Field label="In" value={formatDateTime(leg.block?.in)} />
            </div>
          </Section>

          <Section title="Departure FBO">
            <Field label="Name" value={leg.departure?.fbo?.name} accent />
            <Field label="Address" value={`${leg.departure?.fbo?.address?.street}, ${leg.departure?.fbo?.address?.city}, ${leg.departure?.fbo?.address?.state}`} />
            <Field label="Phone" value={leg.departure?.fbo?.phones?.[0]} />
            <Field label="Hours" value={leg.departure?.fbo?.hours} />
            <Field label="ARINC" value={leg.departure?.fbo?.comms?.arinc} />
          </Section>

          <Section title="Arrival FBO">
            <Field label="Name" value={leg.arrival?.fbo?.name} accent />
            <Field label="Address" value={`${leg.arrival?.fbo?.address?.street}, ${leg.arrival?.fbo?.address?.city}, ${leg.arrival?.fbo?.address?.state}`} />
            <Field label="Phone" value={leg.arrival?.fbo?.phones?.[0]} />
            <Field label="Hours" value={leg.arrival?.fbo?.hours} />
            <Field label="ARINC" value={leg.arrival?.fbo?.comms?.arinc} />
          </Section>
        </div>

        <div>
          <Section title="Pilots">
            {leg.pilots?.length > 0 ? leg.pilots.map((p, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: i < leg.pilots.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'rgba(79,142,247,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: '500', color: 'var(--accent)', flexShrink: 0 }}>
                  {p.user.firstName?.[0]}{p.user.lastName?.[0]}
                </div>
                <div>
                  <p style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: '500' }}>{p.user.firstName} {p.user.lastName}</p>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    {p.seat === 2 ? 'Captain (PIC)' : p.seat === 3 ? 'First Officer (SIC)' : `Seat ${p.seat}`}
                    {p.takeoff ? ' · Takeoff' : ''}{p.landing ? ' · Landing' : ''}
                  </p>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{p.user.email}</p>
                </div>
              </div>
            )) : <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>No pilots assigned</p>}
          </Section>

          <Section title="Passengers">
            {leg.passengers?.length > 0 ? leg.passengers.map((p, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: i < leg.passengers.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(168,85,247,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '500', color: '#a855f7', flexShrink: 0 }}>
                  {p.user.firstName?.[0]}{p.user.lastName?.[0]}
                </div>
                <p style={{ fontSize: '14px', color: 'var(--text-primary)' }}>{p.user.firstName} {p.user.middleName} {p.user.lastName}</p>
              </div>
            )) : <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>No passengers listed</p>}
          </Section>

          <Section title="Trip Checklist">
            {Object.entries(checklist).map(([section, items]) => (
              <div key={section} style={{ marginBottom: '16px' }}>
                <p style={{ fontSize: '12px', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', fontWeight: '500' }}>{section.replace(/([A-Z])/g, ' $1')}</p>
                {typeof items === 'object' && items !== null && !('value' in items)
                  ? Object.entries(items).map(([k, v]) => (
                    <CheckItem key={k} label={k} value={typeof v === 'object' ? v?.value : v} />
                  ))
                  : <CheckItem label={section} value={items?.value} />
                }
              </div>
            ))}
          </Section>

          {ffFlightId && (
            <Section title="ForeFlight Reports">
              {ffLoading ? (
                <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Loading ForeFlight data...</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {[
                    { label: 'Briefing', data: ffBriefing },
                    { label: 'Navlog', data: ffNavlog },
                    { label: 'Weight & Balance', data: ffWb },
                    { label: 'Overflight Report', data: ffOverflight },
                    { label: 'ICAO Document', data: ffIcao },
                  ].map(({ label, data }) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                      <span style={{ fontSize: '14px', color: 'var(--text-primary)' }}>{label}</span>
                      {data ? (
                        <span style={{ fontSize: '12px', color: 'var(--success)', fontWeight: '500' }}>✓ Available</span>
                      ) : (
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Not available</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
