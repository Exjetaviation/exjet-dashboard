import { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';

const PERF_FIELDS = [
  { key: 'cruise_speed_kt', label: 'Cruise Speed (kt)' },
  { key: 'fuel_burn_1_lbs', label: 'Fuel Burn 1 (lbs)' },
  { key: 'fuel_burn_2_lbs', label: 'Fuel Burn 2 (lbs)' },
  { key: 'fuel_burn_3_lbs', label: 'Fuel Burn 3 (lbs)' },
  { key: 'max_altitude_ft', label: 'Max Altitude (ft)' },
  { key: 'max_landing_weight_lbs', label: 'Max Landing Wt (lbs)' },
  { key: 'min_landing_distance_ft', label: 'Min Landing Dist (ft)' },
  { key: 'max_gross_takeoff_weight_lbs', label: 'Max Gross T/O Wt (lbs)' },
  { key: 'max_fuel_capacity_lbs', label: 'Max Fuel Capacity (lbs)' },
];

const inputStyle = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '6px 10px',
  color: 'var(--text-primary)',
  fontSize: 13,
  width: '100%',
  boxSizing: 'border-box',
};

const labelStyle = {
  display: 'block',
  fontSize: 11,
  color: 'var(--text-secondary)',
  marginBottom: 4,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

export default function AircraftPerformanceForm({ aircraft, onSaved }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!aircraft) return;
    const init = {};
    PERF_FIELDS.forEach(({ key }) => { init[key] = aircraft[key] ?? ''; });
    setForm(init);
  }, [aircraft]);

  const handleChange = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSaveMsg(null);
      const body = {};
      PERF_FIELDS.forEach(({ key }) => {
        const v = form[key];
        if (v === '' || v === null || v === undefined) {
          body[key] = null;
        } else {
          const n = Number(v);
          body[key] = isNaN(n) ? null : n;
        }
      });
      const res = await apiFetch(`/api/fleet/aircraft/${aircraft.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      const updated = await res.json();
      setSaveMsg('Saved.');
      if (onSaved) onSaved(updated);
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!aircraft) return null;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
        {PERF_FIELDS.map(({ key, label }) => (
          <div key={key}>
            <label style={labelStyle}>{label}</label>
            <input
              type="number"
              style={inputStyle}
              value={form[key] ?? ''}
              onChange={(e) => handleChange(key, e.target.value)}
            />
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saveMsg && <span style={{ fontSize: 12, color: '#22c55e' }}>{saveMsg}</span>}
        {error && <span style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</span>}
      </div>
    </div>
  );
}
