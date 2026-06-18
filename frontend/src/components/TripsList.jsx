// frontend/src/components/TripsList.jsx
// Trips view: legs grouped into collapsible trip cards with quick actions. Expanding
// shows the trip's legs via FlightsList. Itinerary opens the public page; Trip Sheet
// uses the shared TripSheetActions modal; "View trip" opens the dashboard trip page.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE } from '../lib/api';
import { groupLegsIntoTrips } from '../lib/trips';
import FlightsList from './FlightsList';
import TripSheetActions from './TripSheetActions';

const STATUS_MAP = {
  0: { label: 'Scheduled', color: '#4f8ef7' },
  1: { label: 'Active', color: '#f59e0b' },
  2: { label: 'Booked', color: '#a855f7' },
  3: { label: 'Completed', color: '#22c55e' },
};
const fmtDate = (ms) => (ms && Number.isFinite(ms) ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const range = (a, b) => (fmtDate(a) === fmtDate(b) ? fmtDate(a) : `${fmtDate(a)} – ${fmtDate(b)}`);

const HIDE = new Set(['aircraft']);

export default function TripsList({ legs = [], loading = false, basePath = '/trips', tripBasePath }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(() => new Set());
  const trips = groupLegsIntoTrips(legs);

  const toggle = (id) => setOpen((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  if (loading) return <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Loading trips…</div>;
  if (!trips.length) return <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>No trips match the current filter.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {trips.map((t) => {
        const s = STATUS_MAP[t.status] || { label: '—', color: '#888' };
        const expanded = open.has(t.dispatchId);
        const hasDispatch = t.dispatchId !== 'ungrouped';
        return (
          <div key={t.dispatchId} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', flexWrap: 'wrap' }}>
              <button onClick={() => toggle(t.dispatchId)} title={expanded ? 'Collapse' : 'Expand'}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 14, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▶</button>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{t.routeSummary || '—'}</span>
                  {t.tripId && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Trip #{t.tripId}</span>}
                  <span style={{ background: `${s.color}22`, color: s.color, border: `1px solid ${s.color}44`, borderRadius: 20, padding: '2px 9px', fontSize: 11 }}>{s.label}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>
                  {range(t.start, t.end)} · {t.tail || '—'} · {t.legCount} leg{t.legCount === 1 ? '' : 's'}{t.client ? ` · ${t.client}` : ''}
                </div>
              </div>
              {hasDispatch && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button onClick={() => navigate(`${basePath}/${t.dispatchId}`, { state: { trip: t } })}
                    style={{ padding: '5px 10px', background: 'var(--bg-secondary, #11161f)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>View trip ↗</button>
                  <a href={`${API_BASE}/itinerary/${t.dispatchId}`} target="_blank" rel="noopener noreferrer"
                    style={{ padding: '5px 10px', background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, textDecoration: 'none' }}>Itinerary</a>
                  <TripSheetActions dispatchId={t.dispatchId} tripId={t.tripId} compact />
                </div>
              )}
            </div>
            {expanded && (
              <div style={{ borderTop: '1px solid var(--border)' }}>
                <FlightsList legs={t.legs} hideColumns={HIDE} tripBasePath={tripBasePath} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
