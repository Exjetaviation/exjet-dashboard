import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { apiFetch } from '../../lib/api';

const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' };

export default function FleetComponents() {
  const base = useLocation().pathname.startsWith('/scheduling') ? '/scheduling' : '/fleet';
  const [components, setComponents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await apiFetch('/api/fleet/components');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setComponents(Array.isArray(data) ? data : []);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Link
            to={base}
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13, textDecoration: 'none' }}
          >
            ← Fleet
          </Link>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Fleet Components</h1>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>
          Add components from the{' '}
          <Link to={base} style={{ color: 'var(--accent)' }}>aircraft detail page</Link>.
        </p>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '12px 16px', color: 'var(--danger)', marginBottom: 16 }}>
          Error loading components: {error}
        </div>
      )}

      {loading ? (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Loading components…</p>
      ) : components.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No components found.</p>
      ) : (
        <div style={card}>
          <div className="scroll-x">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 700 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Tail / Aircraft', 'Type', 'Serial', 'Model', 'Manufacturer', 'Note', 'Total Hrs', 'Total Cycles'].map((h) => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {components.map((comp, i) => (
                <tr key={comp.id ?? i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 14px', color: 'var(--accent)', fontWeight: 600 }}>
                    {comp.tail
                      ? <Link to={`${base}/aircraft/${comp.tail}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>{comp.tail}</Link>
                      : (comp.aircraft_id || '—')}
                  </td>
                  <td style={{ padding: '10px 14px', color: 'var(--text-primary)' }}>{comp.component_type || '—'}</td>
                  <td style={{ padding: '10px 14px', color: 'var(--text-primary)' }}>{comp.serial || '—'}</td>
                  <td style={{ padding: '10px 14px', color: 'var(--text-primary)' }}>{comp.model || '—'}</td>
                  <td style={{ padding: '10px 14px', color: 'var(--text-secondary)' }}>{comp.manufacturer || '—'}</td>
                  <td style={{ padding: '10px 14px', color: 'var(--text-secondary)' }}>{comp.note || '—'}</td>
                  <td style={{ padding: '10px 14px', color: 'var(--accent)', fontWeight: 600 }}>{comp.total_hours ?? '—'}</td>
                  <td style={{ padding: '10px 14px', color: 'var(--accent)' }}>{comp.total_cycles ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
