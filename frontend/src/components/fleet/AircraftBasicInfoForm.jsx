import { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';

const BASIC_FIELDS = [
  { key: 'tail', label: 'Tail' },
  { key: 'serial', label: 'Serial' },
  { key: 'color', label: 'Color' },
  { key: 'call_sign', label: 'Call Sign' },
  { key: 'cbp_decal_number', label: 'CBP Decal #' },
  { key: 'year', label: 'Year' },
  { key: 'amenities', label: 'Amenities' },
  { key: 'base_icao', label: 'Base ICAO' },
  { key: 'fbo_name', label: 'FBO Name' },
  { key: 'owner_company', label: 'Owner Company' },
  { key: 'aircraft_type', label: 'Aircraft Type' },
  { key: 'engines_count', label: 'Engines' },
  { key: 'pax_seats', label: 'Pax Seats' },
];

const BOOL_FIELDS = [
  { key: 'is_91_only', label: 'Part 91 Only' },
  { key: 'foreflight_enabled', label: 'ForeFlight Enabled' },
  { key: 'active', label: 'Active' },
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

export default function AircraftBasicInfoForm({ aircraft, onSaved }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!aircraft) return;
    const init = {};
    [...BASIC_FIELDS, ...BOOL_FIELDS].forEach(({ key }) => {
      init[key] = aircraft[key] ?? '';
    });
    setForm(init);
  }, [aircraft]);

  const handleChange = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSaveMsg(null);
      const body = {};
      BASIC_FIELDS.forEach(({ key }) => {
        body[key] = form[key] === '' ? null : form[key];
      });
      BOOL_FIELDS.forEach(({ key }) => {
        body[key] = !!form[key];
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
        {BASIC_FIELDS.map(({ key, label }) => (
          <div key={key}>
            <label style={labelStyle}>{label}</label>
            <input
              style={inputStyle}
              value={form[key] ?? ''}
              onChange={(e) => handleChange(key, e.target.value)}
            />
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 24, marginBottom: 24, flexWrap: 'wrap' }}>
        {BOOL_FIELDS.map(({ key, label }) => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-primary)' }}>
            <input
              type="checkbox"
              checked={!!form[key]}
              onChange={(e) => handleChange(key, e.target.checked)}
              style={{ accentColor: 'var(--accent)', width: 14, height: 14 }}
            />
            {label}
          </label>
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
