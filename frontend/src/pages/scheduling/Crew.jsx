import { useApi } from '../../hooks/useApi';
import { distinctCrew } from '../../lib/schedulingAggregate';

// Crew roster derived from the legs' pilots/attendants assignments.
const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' };
const roleColor = { PIC: '#f59e0b', SIC: '#4f8ef7', Cabin: '#22c55e' };

export default function SchedulingCrew() {
  const { data, loading, error } = useApi('/api/scheduling/legs');
  const crew = distinctCrew(data?.legs || []);

  if (error) return <div style={{ ...card, color: 'var(--danger)' }}>Error loading crew: {error}</div>;
  if (loading) return <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Loading crew…</p>;
  if (!crew.length) return <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No crew assignments in the mirror.</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {crew.map((c, i) => {
        const color = roleColor[c.role] || '#888';
        return (
          <div key={i} style={{ ...card, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: `${color}22`, color, border: `1px solid ${color}44` }}>{c.role}</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{c.name}</span>
              {c.title && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{c.title}</span>}
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {c.legCount} leg{c.legCount === 1 ? '' : 's'} · {c.tripCount} trip{c.tripCount === 1 ? '' : 's'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
