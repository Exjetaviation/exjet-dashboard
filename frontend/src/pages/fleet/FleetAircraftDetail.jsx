import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { apiFetch } from '../../lib/api';
import AircraftBasicInfoForm from '../../components/fleet/AircraftBasicInfoForm';
import AircraftPerformanceForm from '../../components/fleet/AircraftPerformanceForm';
import ComponentList from '../../components/fleet/ComponentList';

const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 24 };
const SECTIONS = ['Basic Info', 'Performance', 'Components'];

export default function FleetAircraftDetail() {
  const { tail } = useParams();
  const navigate = useNavigate();
  const base = useLocation().pathname.startsWith('/scheduling') ? '/scheduling' : '/fleet';
  const [aircraft, setAircraft] = useState(null);
  const [components, setComponents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [section, setSection] = useState('Basic Info');

  const fetchAircraft = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch(`/api/fleet/aircraft/${tail}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAircraft(data);
      setComponents(Array.isArray(data.components) ? data.components : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tail]);

  useEffect(() => { fetchAircraft(); }, [fetchAircraft]);

  const handleAircraftSaved = (updated) => {
    setAircraft((prev) => ({ ...prev, ...updated }));
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <button
          onClick={() => navigate(`${base}?section=aircraft`)}
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13 }}
        >
          ← Fleet
        </button>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            {(tail || '').toUpperCase()}
            {aircraft?.aircraft_type && (
              <span style={{ color: 'var(--text-secondary)', fontWeight: 400, fontSize: 18 }}>
                {' '}— {aircraft.aircraft_type}
              </span>
            )}
          </h1>
          {aircraft && (
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4, marginBottom: 0 }}>
              {aircraft.base_icao || '—'} · {aircraft.pax_seats ?? '—'} seats
              {' · '}
              <span style={{ color: aircraft.active ? '#22c55e' : 'var(--danger)' }}>
                {aircraft.active ? 'Active' : 'Inactive'}
              </span>
            </p>
          )}
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '12px 16px', color: 'var(--danger)', marginBottom: 16 }}>
          Error loading aircraft: {error}
        </div>
      )}

      {loading ? (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Loading…</p>
      ) : aircraft ? (
        <>
          <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
            {SECTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setSection(s)}
                style={{
                  background: 'none',
                  border: 'none',
                  borderBottom: section === s ? '2px solid var(--accent)' : '2px solid transparent',
                  padding: '10px 18px',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: section === s ? 600 : 400,
                  color: section === s ? 'var(--accent)' : 'var(--text-secondary)',
                  transition: 'color 0.1s',
                  marginBottom: -1,
                }}
              >
                {s}
              </button>
            ))}
          </div>

          <div style={card}>
            {section === 'Basic Info' && (
              <AircraftBasicInfoForm aircraft={aircraft} onSaved={handleAircraftSaved} />
            )}
            {section === 'Performance' && (
              <AircraftPerformanceForm aircraft={aircraft} onSaved={handleAircraftSaved} />
            )}
            {section === 'Components' && (
              <ComponentList aircraft={aircraft} components={components} />
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
