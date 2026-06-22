// Tab navigation for the Trip Overview. Mirrors the SectionTab pattern in
// pages/Scheduling.jsx (accent text + 2px underline when active).
export default function TripTabs({ tabs, active, onSelect }) {
  return (
    <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 16, flexWrap: 'wrap' }}>
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onSelect(t.id)}
          style={{
            padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'none', border: 'none',
            color: active === t.id ? 'var(--accent)' : 'var(--text-secondary)',
            borderBottom: active === t.id ? '2px solid var(--accent)' : '2px solid transparent',
          }}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
