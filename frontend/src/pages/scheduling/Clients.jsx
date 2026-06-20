import { useApi } from '../../hooks/useApi';
import { distinctClients } from '../../lib/schedulingAggregate';

// Customers derived from the mirror legs (distinct client companies + counts).
const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' };

export default function SchedulingClients() {
  const { data, loading, error } = useApi('/api/scheduling/legs');
  const clients = distinctClients(data?.legs || []);

  if (error) return <div style={{ ...card, color: 'var(--danger)' }}>Error loading clients: {error}</div>;
  if (loading) return <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Loading clients…</p>;
  if (!clients.length) return <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No clients in the mirror.</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {clients.map((c) => (
        <div key={c.name} style={{ ...card, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{c.name}</span>
            {c.wholesale && (
              <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: 'rgba(168,85,247,0.12)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.3)' }}>Wholesale</span>
            )}
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {c.tripCount} trip{c.tripCount === 1 ? '' : 's'} · {c.legCount} leg{c.legCount === 1 ? '' : 's'}
          </span>
        </div>
      ))}
    </div>
  );
}
