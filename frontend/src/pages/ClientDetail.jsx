import { useLocation, useNavigate } from 'react-router-dom';

const STATUS_MAP = {
  0: { label: 'Scheduled', color: '#4f8ef7' },
  1: { label: 'Active', color: '#f59e0b' },
  2: { label: 'Booked', color: '#a855f7' },
  3: { label: 'Completed', color: '#22c55e' },
};

const formatDate = (ms) => {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatTime = (ms) => {
  if (!ms) return '—';
  return new Date(ms).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
};

export default function ClientDetail() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const client = state?.client;

  if (!client) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
        <p>Client not found.</p>
        <button onClick={() => navigate('/clients')} style={{ marginTop: '16px', padding: '8px 20px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
          Back to Clients
        </button>
      </div>
    );
  }

  const legs = [...client.legs].sort((a, b) => (b.departure?.time || 0) - (a.departure?.time || 0));
  const completedLegs = legs.filter(l => l.status === 3);
  const upcomingLegs = legs.filter(l => l.status !== 3);
  const scorePercent = client.score && client.maxScore ? Math.round((client.score / client.maxScore) * 100) : null;
  const totalPax = legs.reduce((acc, l) => acc + (l.passengerCount || 0), 0);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '28px' }}>
        <button onClick={() => navigate('/clients')} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 14px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '13px' }}>
          ← Clients
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(79,142,247,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: '500', color: 'var(--accent)' }}>
            {client.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: '600', color: 'var(--text-primary)' }}>{client.name}</h1>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              {client.wholesale ? 'Wholesale Client' : 'Direct Client'}
              {scorePercent !== null ? ` · Score: ${scorePercent}%` : ''}
            </p>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px', marginBottom: '28px' }}>
        {[
          { label: 'Total Legs', value: legs.length, color: 'var(--accent)' },
          { label: 'Completed', value: completedLegs.length, color: 'var(--success)' },
          { label: 'Upcoming', value: upcomingLegs.length, color: '#f59e0b' },
          { label: 'Total Passengers', value: totalPax, color: '#a855f7' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px 24px', borderTop: `3px solid ${color}` }}>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
            <p style={{ fontSize: '32px', fontWeight: '600', color: 'var(--text-primary)', lineHeight: 1 }}>{value}</p>
          </div>
        ))}
      </div>

      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
          <h2 style={{ fontSize: '14px', fontWeight: '500', color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Flight History</h2>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
                {['Date', 'Route', 'Aircraft', 'Flight Time', 'Pilots', 'Pax', 'Status'].map(h => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: '11px', fontWeight: '500', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {legs.map((leg, i) => {
                const s = STATUS_MAP[leg.status] || { label: 'Unknown', color: '#888' };
                return (
                  <tr key={leg._id?.$oid || i}
                    onClick={() => navigate(`/flights/${leg._id?.$oid}`, { state: { leg } })}
                    style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(79,142,247,0.06)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '14px 16px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      <div>{formatDate(leg.departure?.time)}</div>
                      <div style={{ fontSize: '11px', marginTop: '2px' }}>{formatTime(leg.departure?.time)}</div>
                    </td>
                    <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ color: 'var(--text-primary)', fontWeight: '500' }}>{leg.departure?.airport}</span>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>✈</span>
                        <span style={{ color: 'var(--text-primary)', fontWeight: '500' }}>{leg.arrival?.airport}</span>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>{leg._calc?.distance?.value} nm</div>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ color: 'var(--accent)', fontWeight: '500' }}>{leg.dispatch?.aircraft?.tailNumber || '—'}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>{leg.dispatch?.aircraft?.type?.name || '—'}</div>
                    </td>
                    <td style={{ padding: '14px 16px', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{leg._calc?.time || '—'}</td>
                    <td style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>
                      {leg.pilots?.map(p => `${p.user.firstName} ${p.user.lastName}`).join(', ') || '—'}
                    </td>
                    <td style={{ padding: '14px 16px', color: 'var(--text-primary)', textAlign: 'center' }}>{leg.passengerCount ?? '—'}</td>
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{ background: `${s.color}22`, color: s.color, border: `1px solid ${s.color}44`, borderRadius: '20px', padding: '3px 10px', fontSize: '12px', fontWeight: '500' }}>
                        {s.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
