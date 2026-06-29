import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { apiFetch } from '../../lib/api';
import AddAircraftModal from '../../components/fleet/AddAircraftModal';

const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12 };
const btn = { background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600 };
const btnSec = { background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13, textDecoration: 'none', display: 'inline-block' };

export default function FleetAircraftList({ basePath = '/fleet' }) {
  const navigate = useNavigate();
  const [aircraft, setAircraft] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const fetchAircraft = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch('/api/fleet/aircraft');
      const data = await res.json();
      setAircraft(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAircraft(); }, [fetchAircraft]);

  const handleImport = async () => {
    try {
      setImporting(true);
      setImportResult(null);
      setError(null);
      const res = await apiFetch('/api/fleet/aircraft/import', { method: 'POST' });
      const data = await res.json();
      setImportResult(data);
      await fetchAircraft();
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const handleAircraftCreated = (created) => {
    setShowAddModal(false);
    navigate(`${basePath}/aircraft/${created.tail}`);
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Fleet Aircraft</h1>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Link to={`${basePath}/components`} style={btnSec}>Components</Link>
          <button onClick={() => setShowAddModal(true)} style={btnSec}>
            + Add Aircraft
          </button>
          <button onClick={handleImport} disabled={importing} style={btn}>
            {importing ? 'Importing…' : 'Import from LevelFlight'}
          </button>
        </div>
      </div>

      {importResult && (
        <div style={{ ...card, padding: '12px 16px', marginBottom: 16, color: 'var(--text-primary)', fontSize: 13 }}>
          Import complete — {importResult.aircraft ?? 0} aircraft, {importResult.components ?? 0} components updated.
        </div>
      )}

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '12px 16px', color: 'var(--danger)', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Loading fleet…</p>
      ) : aircraft.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          No aircraft found. Use "Import from LevelFlight" to get started.
        </p>
      ) : (
        <div style={{ ...card, overflow: 'hidden', padding: 0 }}>
          <div className="scroll-x">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 480 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Tail', 'Type', 'Base', 'Seats', 'Status'].map((h) => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 12 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {aircraft.map((ac) => (
                <tr
                  key={ac.id}
                  onClick={() => navigate(`${basePath}/aircraft/${ac.tail}`)}
                  style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-secondary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <td style={{ padding: '10px 16px', fontWeight: 700, color: 'var(--accent)' }}>{ac.tail}</td>
                  <td style={{ padding: '10px 16px', color: 'var(--text-primary)' }}>{ac.aircraft_type || '—'}</td>
                  <td style={{ padding: '10px 16px', color: 'var(--text-primary)' }}>{ac.base_icao || '—'}</td>
                  <td style={{ padding: '10px 16px', color: 'var(--text-primary)' }}>{ac.pax_seats ?? '—'}</td>
                  <td style={{ padding: '10px 16px' }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                      background: ac.active ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.1)',
                      color: ac.active ? '#22c55e' : 'var(--danger)',
                    }}>
                      {ac.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {showAddModal && (
        <AddAircraftModal
          onClose={() => setShowAddModal(false)}
          onCreated={handleAircraftCreated}
        />
      )}
    </div>
  );
}
