import { useApi } from '../hooks/useApi';
import { useNavigate } from 'react-router-dom';

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

const getPilotNames = (pilots) => {
  if (!pilots || pilots.length === 0) return '—';
  return pilots.map(p => `${p.user.firstName} ${p.user.lastName}`).join(', ');
};

const getStatus = (status) => {
  const s = STATUS_MAP[status] || { label: 'Unknown', color: '#888' };
  return (
    <span style={{
      background: `${s.color}22`, color: s.color,
      border: `1px solid ${s.color}44`, borderRadius: '20px',
      padding: '3px 10px', fontSize: '12px', fontWeight: '500', whiteSpace: 'nowrap',
    }}>{s.label}</span>
  );
};

export default function Flights() {
  const { data, loading, error } = useApi('/api/levelflight/legs');
  const navigate = useNavigate();
  const legs = data?.legs || [];
  const sorted = [...legs].sort((a, b) => (a.departure?.time || 0) - (b.departure?.time || 0));

  return (
    <div>
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: '600', color: 'var(--text-primary)' }}>Flights</h1>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px' }}>
          {loading ? 'Loading...' : `${legs.length} legs this month · click a row to view details`}
        </p>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '12px 16px', color: 'var(--danger)', marginBottom: '16px' }}>
          Error loading flights: {error}
        </div>
      )}

      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
                {['Date', 'Route', 'Aircraft', 'Flight Time', 'Pilots', 'Pax', 'Client', 'Status'].map(h => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: '11px', fontWeight: '500', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading flights...</td></tr>
              ) : sorted.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>No flights found for this month</td></tr>
              ) : sorted.map((leg, i) => (
                <tr key={leg._id?.$oid || i}
                  style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: 'background 0.1s' }}
                  onClick={() => navigate(`/flights/${leg._id?.$oid}`, { state: { leg } })}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(79,142,247,0.06)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ padding: '14px 16px', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                    <div>{formatDate(leg.departure?.time)}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      {new Date(leg.departure?.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </td>
                  <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ color: 'var(--text-primary)', fontWeight: '500' }}>{leg.departure?.airport}</span>
                      <span style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>✈</span>
                      <span style={{ color: 'var(--text-primary)', fontWeight: '500' }}>{leg.arrival?.airport}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>{leg._calc?.distance?.value} nm</div>
                  </td>
                  <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                    <div style={{ color: 'var(--accent)', fontWeight: '500' }}>{leg.dispatch?.aircraft?.tailNumber || '—'}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>{leg.dispatch?.aircraft?.type?.name || '—'}</div>
                  </td>
                  <td style={{ padding: '14px 16px', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{leg._calc?.time || '—'}</td>
                  <td style={{ padding: '14px 16px', color: 'var(--text-secondary)', maxWidth: '180px' }}>{getPilotNames(leg.pilots)}</td>
                  <td style={{ padding: '14px 16px', color: 'var(--text-primary)', textAlign: 'center' }}>{leg.passengerCount ?? '—'}</td>
                  <td style={{ padding: '14px 16px', color: 'var(--text-secondary)', maxWidth: '150px' }}>{leg.dispatch?.client?.company?.name || '—'}</td>
                  <td style={{ padding: '14px 16px' }}>{getStatus(leg.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
