import { API_BASE } from '../../lib/api';

const ACTION_COLOR = { book: '#a855f7', release: '#3b82f6', cancel: '#ef4444' };

// Right-hand actions rail for the Trip Overview. Pure: receives the trip meta + the
// handlers that already live in SchedulingTripDetail.
export default function TripActionsRail({ meta, id, busy, onAction, onRevert, onSendItinerary, released }) {
  const btn = { padding: '8px 14px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none', cursor: busy ? 'default' : 'pointer', color: '#fff', opacity: busy ? 0.6 : 1, textAlign: 'center', textDecoration: 'none', display: 'block' };
  const linkBtn = { padding: '8px 14px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'center', textDecoration: 'none', display: 'block' };
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, flex: '0 0 220px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 11, letterSpacing: 2, color: 'var(--text-secondary)' }}>STATUS</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 20, padding: '3px 10px' }}>{meta?.status_label || '—'}</span>
      </div>
      {(meta?.actions || []).map((a) => (
        <button key={a.action} onClick={() => onAction(a.status)} disabled={busy || !meta}
          style={{ ...btn, background: ACTION_COLOR[a.action] || 'var(--accent)' }}>{a.label}</button>
      ))}
      {meta?.locally_modified && meta?.origin === 'levelflight' && (
        <button onClick={onRevert} disabled={busy} style={{ ...linkBtn, color: '#f59e0b', borderColor: 'rgba(245,158,11,0.4)' }}>⟲ Revert to LevelFlight</button>
      )}
      <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
      <a href={`${API_BASE}/itinerary/${id}`} target="_blank" rel="noopener noreferrer" style={linkBtn}>View Passenger Itinerary ↗</a>
      <button onClick={onSendItinerary} disabled={busy} style={{ ...btn, background: 'var(--accent)' }}>✉ Send Itinerary</button>
      {released && <a href={`/scheduling/trips/${id}/sheet`} target="_blank" rel="noopener noreferrer" style={linkBtn}>View Crew Trip Sheet ↗</a>}
    </div>
  );
}
