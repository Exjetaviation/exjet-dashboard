import { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';
import AddComponentModal from './AddComponentModal';
import ComponentLedger from './ComponentLedger';

const tableCard = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' };

const btnSmStyle = {
  background: 'var(--bg-secondary)',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '3px 8px',
  cursor: 'pointer',
  fontSize: 11,
  whiteSpace: 'nowrap',
};

function ManualEntryRow({ component, onUpdated }) {
  const [form, setForm] = useState({ hours_delta: '', cycles_delta: '', note: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      setErr(null);
      const body = {
        source: 'manual',
        hours_delta: form.hours_delta === '' ? 0 : Number(form.hours_delta),
        cycles_delta: form.cycles_delta === '' ? 0 : Number(form.cycles_delta),
        note: form.note || null,
      };
      const res = await apiFetch(`/api/fleet/components/${component.id}/entries`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e2 = await res.json().catch(() => ({}));
        throw new Error(e2.error || `HTTP ${res.status}`);
      }
      const updated = await res.json();
      setForm({ hours_delta: '', cycles_delta: '', note: '' });
      if (onUpdated) onUpdated(updated);
    } catch (err2) {
      setErr(err2.message);
    } finally {
      setSaving(false);
    }
  };

  const miniInput = {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    padding: '3px 6px',
    color: 'var(--text-primary)',
    fontSize: 11,
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
      <input
        type="number"
        placeholder="Hrs Δ"
        value={form.hours_delta}
        onChange={(e) => setForm((f) => ({ ...f, hours_delta: e.target.value }))}
        style={{ ...miniInput, width: 60 }}
      />
      <input
        type="number"
        placeholder="Cyc Δ"
        value={form.cycles_delta}
        onChange={(e) => setForm((f) => ({ ...f, cycles_delta: e.target.value }))}
        style={{ ...miniInput, width: 60 }}
      />
      <input
        type="text"
        placeholder="Note"
        value={form.note}
        onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
        style={{ ...miniInput, width: 100 }}
      />
      <button
        type="submit"
        disabled={saving}
        style={{ ...btnSmStyle, background: 'var(--accent)', color: '#fff', border: 'none' }}
      >
        {saving ? '…' : 'Log'}
      </button>
      {err && <span style={{ color: 'var(--danger)', fontSize: 10 }}>{err}</span>}
    </form>
  );
}

export default function ComponentList({ aircraft, components: initialComponents }) {
  const [components, setComponents] = useState(initialComponents || []);
  const [showAdd, setShowAdd] = useState(false);
  const [ledgerFor, setLedgerFor] = useState(null);

  useEffect(() => {
    setComponents(initialComponents || []);
  }, [initialComponents]);

  const handleAdded = (newComp) => {
    setComponents((prev) => [...prev, newComp]);
  };

  const handleEntryLogged = (updatedComp) => {
    setComponents((prev) =>
      prev.map((c) => (c.id === updatedComp.id ? { ...c, ...updatedComp } : c))
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {components.length} component{components.length === 1 ? '' : 's'}
        </span>
        <button
          onClick={() => setShowAdd(true)}
          style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
        >
          + Add Component
        </button>
      </div>

      {components.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No components yet.</p>
      ) : (
        <div style={tableCard}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Type', 'Position', 'Serial', 'Model', 'Manufacturer', 'Total Hrs', 'Total Cycles', 'Actions'].map((h) => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 11 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {components.map((comp) => (
                <tr key={comp.id} style={{ borderBottom: '1px solid var(--border)', verticalAlign: 'top' }}>
                  <td style={{ padding: '10px 12px', color: 'var(--text-primary)', fontWeight: 600 }}>{comp.component_type || '—'}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{comp.position || '—'}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-primary)' }}>{comp.serial || '—'}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-primary)' }}>{comp.model || '—'}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{comp.manufacturer || '—'}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--accent)', fontWeight: 600 }}>{comp.total_hours ?? '—'}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--accent)' }}>{comp.total_cycles ?? '—'}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <button onClick={() => setLedgerFor(comp.id)} style={btnSmStyle}>
                      Ledger
                    </button>
                    <ManualEntryRow component={comp} onUpdated={handleEntryLogged} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <AddComponentModal
          aircraftId={aircraft.id}
          onClose={() => setShowAdd(false)}
          onAdded={handleAdded}
        />
      )}

      {ledgerFor !== null && (
        <ComponentLedger
          componentId={ledgerFor}
          onClose={() => setLedgerFor(null)}
        />
      )}
    </div>
  );
}
