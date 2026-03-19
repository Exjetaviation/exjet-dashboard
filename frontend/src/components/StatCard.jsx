export default function StatCard({ label, value, sub, color }) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: '12px',
      padding: '20px 24px',
      borderTop: `3px solid ${color || 'var(--accent)'}`,
    }}>
      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
      <p style={{ fontSize: '32px', fontWeight: '600', color: 'var(--text-primary)', lineHeight: 1 }}>{value ?? '—'}</p>
      {sub && <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '6px' }}>{sub}</p>}
    </div>
  );
}
