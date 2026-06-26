import { useState } from 'react';
import { apiFetch } from '../../lib/api';

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

export default function AddAircraftModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    tail: '',
    aircraft_type: '',
    base_icao: '',
    pax_seats: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.tail.trim()) {
      setError('Tail number is required.');
      return;
    }
    try {
      setSaving(true);
      setError(null);
      const body = {
        tail: form.tail.trim().toUpperCase(),
        aircraft_type: form.aircraft_type || null,
        base_icao: form.base_icao || null,
        pax_seats: form.pax_seats === '' ? null : Number(form.pax_seats),
      };
      const res = await apiFetch('/api/fleet/aircraft', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e2 = await res.json().catch(() => ({}));
        throw new Error(e2.error || `HTTP ${res.status}`);
      }
      const created = await res.json();
      onCreated(created);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, width: 440, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Add Aircraft</h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>
              Tail Number <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <input
              type="text"
              value={form.tail}
              onChange={(e) => handleChange('tail', e.target.value)}
              placeholder="e.g. N123AB"
              style={inputStyle}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Aircraft Type</label>
            <input
              type="text"
              value={form.aircraft_type}
              onChange={(e) => handleChange('aircraft_type', e.target.value)}
              placeholder="e.g. Citation CJ3"
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Base ICAO</label>
            <input
              type="text"
              value={form.base_icao}
              onChange={(e) => handleChange('base_icao', e.target.value)}
              placeholder="e.g. KFLL"
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Pax Seats</label>
            <input
              type="number"
              min="0"
              value={form.pax_seats}
              onChange={(e) => handleChange('pax_seats', e.target.value)}
              style={inputStyle}
            />
          </div>

          {error && (
            <div style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 12 }}>{error}</div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
            <button
              type="button"
              onClick={onClose}
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13 }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
            >
              {saving ? 'Adding…' : 'Add Aircraft'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
