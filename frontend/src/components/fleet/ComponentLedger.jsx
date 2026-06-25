import { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';

export default function ComponentLedger({ componentId, onClose }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!componentId) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await apiFetch(`/api/fleet/components/${componentId}/ledger`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setEntries(Array.isArray(data) ? data : []);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [componentId]);

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, width: 720, maxWidth: '95vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Component Ledger</h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {loading && <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Loading…</p>}
        {error && <div style={{ color: 'var(--danger)', fontSize: 13, padding: '8px 0' }}>{error}</div>}
        {!loading && !error && entries.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No ledger entries yet.</p>
        )}

        {entries.length > 0 && (
          <div style={{ overflowY: 'auto', flex: 1 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Source', 'Hrs Δ', 'Cycles Δ', 'Time Source', 'Note', 'Date'].map((h) => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, i) => (
                  <tr key={entry.id ?? i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 12px', color: 'var(--text-primary)' }}>{entry.source || '—'}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--accent)', fontWeight: 600 }}>{entry.hours_delta ?? '—'}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--accent)' }}>{entry.cycles_delta ?? '—'}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{entry.time_source || '—'}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{entry.note || '—'}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {entry.created_at ? new Date(entry.created_at).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
