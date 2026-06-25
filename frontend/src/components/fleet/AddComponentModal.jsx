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

const COMPONENT_TYPES = ['engine', 'apu', 'airframe'];

const TEXT_FIELDS = [
  { key: 'position', label: 'Position' },
  { key: 'serial', label: 'Serial' },
  { key: 'model', label: 'Model' },
  { key: 'manufacturer', label: 'Manufacturer' },
  { key: 'note', label: 'Note' },
];

const NUM_FIELDS = [
  { key: 'baseline_hours', label: 'Baseline Hours' },
  { key: 'baseline_cycles', label: 'Baseline Cycles' },
];

export default function AddComponentModal({ aircraftId, onClose, onAdded }) {
  const [form, setForm] = useState({
    component_type: 'engine',
    position: '',
    serial: '',
    model: '',
    manufacturer: '',
    note: '',
    baseline_hours: '',
    baseline_cycles: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      setError(null);
      const body = {
        component_type: form.component_type,
        position: form.position || null,
        serial: form.serial || null,
        model: form.model || null,
        manufacturer: form.manufacturer || null,
        note: form.note || null,
        baseline_hours: form.baseline_hours === '' ? null : Number(form.baseline_hours),
        baseline_cycles: form.baseline_cycles === '' ? null : Number(form.baseline_cycles),
      };
      const res = await apiFetch(`/api/fleet/aircraft/${aircraftId}/components`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e2 = await res.json().catch(() => ({}));
        throw new Error(e2.error || `HTTP ${res.status}`);
      }
      const created = await res.json();
      onAdded(created);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, width: 480, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Add Component</h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Type</label>
            <select
              value={form.component_type}
              onChange={(e) => handleChange('component_type', e.target.value)}
              style={inputStyle}
            >
              {COMPONENT_TYPES.map((t) => (
                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
          </div>

          {TEXT_FIELDS.map(({ key, label }) => (
            <div key={key} style={{ marginBottom: 14 }}>
              <label style={labelStyle}>{label}</label>
              <input
                type="text"
                value={form[key]}
                onChange={(e) => handleChange(key, e.target.value)}
                style={inputStyle}
              />
            </div>
          ))}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            {NUM_FIELDS.map(({ key, label }) => (
              <div key={key}>
                <label style={labelStyle}>{label}</label>
                <input
                  type="number"
                  value={form[key]}
                  onChange={(e) => handleChange(key, e.target.value)}
                  style={inputStyle}
                />
              </div>
            ))}
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
              {saving ? 'Adding…' : 'Add Component'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
