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

export default function Clients() {
  const { data, loading } = useApi('/api/levelflight/legs');
  const navigate = useNavigate();

  const legs = data?.legs || [];

  const clientMap = {};
  legs.forEach(leg => {
    const company = leg.dispatch?.client?.company;
    if (!company) return;
    const id = company._id?.$oid || company.name;
    if (!clientMap[id]) {
      clientMap[id] = {
        id,
        name: company.name,
        wholesale: company.wholesale,
        score: company.score,
        maxScore: company.maxScore,
        legs: [],
      };
    }
    clientMap[id].legs.push(leg);
  });

  const clients = Object.values(clientMap).sort((a, b) => b.legs.length - a.legs.length);

  return (
    <div>
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: '600', color: 'var(--text-primary)' }}>Clients</h1>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px' }}>
          {loading ? 'Loading...' : `${clients.length} clients this month · click to view trip history`}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '32px' }}>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px 24px', borderTop: '3px solid var(--accent)' }}>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Clients</p>
          <p style={{ fontSize: '32px', fontWeight: '600', color: 'var(--text-primary)', lineHeight: 1 }}>{clients.length}</p>
        </div>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px 24px', borderTop: '3px solid var(--success)' }}>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Wholesale Clients</p>
          <p style={{ fontSize: '32px', fontWeight: '600', color: 'var(--text-primary)', lineHeight: 1 }}>{clients.filter(c => c.wholesale).length}</p>
        </div>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px 24px', borderTop: '3px solid #a855f7' }}>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Legs</p>
          <p style={{ fontSize: '32px', fontWeight: '600', color: 'var(--text-primary)', lineHeight: 1 }}>{legs.length}</p>
        </div>
      </div>

      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
              {['Client', 'Type', 'Legs', 'Last Flight', 'Routes', 'Score'].map(h => (
                <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: '11px', fontWeight: '500', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading clients...</td></tr>
            ) : clients.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>No clients found</td></tr>
            ) : clients.map((client, i) => {
              const lastLeg = [...client.legs].sort((a, b) => (b.departure?.time || 0) - (a.departure?.time || 0))[0];
              const routes = [...new Set(client.legs.map(l => `${l.departure?.airport}→${l.arrival?.airport}`))];
              const scorePercent = client.score && client.maxScore ? Math.round((client.score / client.maxScore) * 100) : null;
              return (
                <tr key={client.id}
                  onClick={() => navigate(`/clients/${client.id}`, { state: { client } })}
                  style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: 'background 0.1s' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(79,142,247,0.06)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'rgba(79,142,247,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '500', color: 'var(--accent)', flexShrink: 0 }}>
                        {client.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <p style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: '500' }}>{client.name}</p>
                    </div>
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <span style={{
                      background: client.wholesale ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.05)',
                      color: client.wholesale ? 'var(--success)' : 'var(--text-secondary)',
                      borderRadius: '20px', padding: '3px 10px', fontSize: '12px', fontWeight: '500',
                    }}>
                      {client.wholesale ? 'Wholesale' : 'Direct'}
                    </span>
                  </td>
                  <td style={{ padding: '14px 16px', color: 'var(--text-primary)', fontWeight: '500' }}>
                    {client.legs.length}
                  </td>
                  <td style={{ padding: '14px 16px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    {formatDate(lastLeg?.departure?.time)}
                  </td>
                  <td style={{ padding: '14px 16px', color: 'var(--text-secondary)', maxWidth: '200px' }}>
                    {routes.slice(0, 2).join(', ')}{routes.length > 2 ? ` +${routes.length - 2}` : ''}
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    {scorePercent !== null ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ flex: 1, height: '4px', background: 'var(--border)', borderRadius: '2px', minWidth: '60px' }}>
                          <div style={{ width: `${scorePercent}%`, height: '100%', background: scorePercent > 70 ? 'var(--success)' : scorePercent > 40 ? 'var(--warning)' : 'var(--danger)', borderRadius: '2px' }} />
                        </div>
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{scorePercent}%</span>
                      </div>
                    ) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
