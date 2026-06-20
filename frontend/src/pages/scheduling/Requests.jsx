// Charter requests — LevelFlight has an incoming-request queue you triage into
// quotes. We don't have a request feed wired yet, so this is the layout + an
// honest empty-state placeholder for that workflow.
const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 };
const cols = '1.4fr 1.6fr 1.2fr 0.6fr 0.9fr';

export default function SchedulingRequests() {
  return (
    <div>
      <div style={{ ...card, marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Charter requests</div>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.5 }}>
          Incoming trip requests (from email or a client form) would land here as a queue you triage into quotes.
          No request feed is connected yet — this is a placeholder for that workflow.
        </p>
      </div>
      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
          <span>Client</span><span>Route</span><span>Dates</span><span>Pax</span><span>Status</span>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', padding: '28px 0' }}>No requests in the queue.</p>
      </div>
    </div>
  );
}
