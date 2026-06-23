import { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';

// Per-airport FBO picker. Lazily fetches /api/scheduling/airport/:icao/fbos (which
// serves our directory + lazy-caches from LevelFlight). onChange emits the FBO in the
// leg-snapshot shape the documents read: { fbo_id, name, address, phones, comms, crewNote }.
const sel = { width: '100%', padding: '7px 10px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, boxSizing: 'border-box' };

export default function FboPicker({ icao, value, onChange, label }) {
  const [fbos, setFbos] = useState([]);
  const [loading, setLoading] = useState(false);
  const code = (icao || '').trim().toUpperCase();
  useEffect(() => {
    let live = true;
    if (code.length < 3) { setFbos([]); return; }
    setLoading(true);
    apiFetch(`/api/scheduling/airport/${code}/fbos`)
      .then((r) => r.json())
      .then((j) => { if (live) setFbos(j.fbos || []); })
      .catch(() => { if (live) setFbos([]); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [code]);

  const toSnapshot = (row) => row ? {
    fbo_id: row.fbo_id, name: row.name, address: row.address || null,
    phones: row.phones || null, comms: row.comms || null, crewNote: null,
  } : null;

  return (
    <div style={{ flex: '1 1 150px' }}>
      {label && <label style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{label}</label>}
      <select value={value?.fbo_id || ''} disabled={code.length < 3}
        onChange={(e) => onChange(toSnapshot(fbos.find((f) => f.fbo_id === e.target.value)))} style={sel}>
        <option value="">{loading ? 'loading…' : (code.length < 3 ? '—' : (fbos.length ? '— FBO —' : 'no FBOs'))}</option>
        {fbos.map((f) => <option key={f.fbo_id} value={f.fbo_id}>{f.name}</option>)}
        {value?.fbo_id && !fbos.some((f) => f.fbo_id === value.fbo_id) && (
          <option value={value.fbo_id}>{value.name}</option>
        )}
      </select>
    </div>
  );
}
