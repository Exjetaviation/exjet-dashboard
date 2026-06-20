import { useState, useEffect } from 'react';
import { useApi } from '../hooks/useApi';
import { apiFetch } from '../lib/api';

const FIELDS = [
  { key: 'aircraft_tail',        label: 'Tail Number',                  type: 'text',   placeholder: 'N69FP' },
  { key: 'aircraft_type',        label: 'Aircraft Type',                type: 'text',   placeholder: 'Gulfstream GIV SP' },
  { key: 'hourly_rate',          label: 'Hourly Rate ($)',               type: 'number', placeholder: '9000', note: 'Flight-time rate; surcharge / FA / crew / landings are separate' },
  { key: 'surcharge_pct',        label: 'Fuel Surcharge (decimal)',      type: 'number', placeholder: '0.20', note: '0.20 = 20% of flight cost' },
  { key: 'positioning_rate',     label: 'Positioning Rate ($/hr)',       type: 'number', placeholder: '4500' },
  { key: 'fa_fee',               label: 'Flight Attendant Fee ($ each)', type: 'number', placeholder: '700' },
  { key: 'crew_fee',             label: 'Crew Fee ($ each)',             type: 'number', placeholder: '600' },
  { key: 'landing_fee',          label: 'Landing Fee ($ each)',          type: 'number', placeholder: '0' },
  { key: 'min_hours',            label: 'Minimum Hours',                 type: 'number', placeholder: '0' },
  { key: 'overnight_fee',        label: 'Overnight Fee ($/night)',       type: 'number', placeholder: '1500' },
  { key: 'overnight_threshold',  label: 'Free Nights Before Fee Kicks In', type: 'number', placeholder: '3', note: 'e.g. 3 = fee starts on night 4' },
  { key: 'short_leg_time',       label: 'Short Leg Threshold (hrs)',     type: 'number', placeholder: '0' },
  { key: 'short_leg_amount',     label: 'Short Leg Fee ($)',             type: 'number', placeholder: '0' },
  { key: 'segment_fee_per_pax',  label: 'Segment Fee ($ per leg/pax)',   type: 'number', placeholder: '0', note: 'Charged per leg per passenger' },
  { key: 'fet_rate',             label: 'FET Rate (decimal)',            type: 'number', placeholder: '0.075', note: '0.075 = 7.5% domestic, 0 = international' },
  { key: 'notes',                label: 'Notes',                        type: 'text',   placeholder: 'Optional notes' },
];

const EMPTY = FIELDS.reduce((acc, f) => ({
  ...acc,
  [f.key]: f.key === 'fet_rate' ? 0.075 : f.key === 'overnight_threshold' ? 3 : '',
}), {});

export default function RateCards() {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const { data: lfAircraft } = useApi('/api/levelflight/aircraft');
  const { data: ffAircraft } = useApi('/api/foreflight/aircraft');

  const fleetTails = [
    ...(Array.isArray(lfAircraft) ? lfAircraft.map(a => a.tailNumber) : []),
    ...(Array.isArray(ffAircraft) ? ffAircraft.map(a => a.aircraftRegistration) : []),
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  const fetchCards = async () => {
    setLoading(true);
    const res = await apiFetch('/api/rate-cards');
    const data = await res.json();
    setCards(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  useEffect(() => { fetchCards(); }, []);

  const openNew = (tail = '') => {
    setEditing('new');
    setForm({ ...EMPTY, aircraft_tail: tail });
  };

  const openEdit = (card) => {
    setEditing(card.id);
    setForm({ ...card });
  };

  const cancel = () => { setEditing(null); setForm(EMPTY); setMsg(null); };

  const save = async () => {
    if (!form.aircraft_tail) return setMsg({ type: 'error', text: 'Tail number is required' });
    setSaving(true);
    try {
      const isNew = editing === 'new';
      const url = isNew ? '/api/rate-cards' : `/api/rate-cards/${editing}`;
      const method = isNew ? 'POST' : 'PUT';
      const res = await apiFetch(url, {
        method,
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Save failed');
      setMsg({ type: 'success', text: isNew ? 'Rate card created' : 'Rate card updated' });
      await fetchCards();
      setTimeout(() => { cancel(); }, 1200);
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!confirm('Delete this rate card?')) return;
    await apiFetch(`/api/rate-cards/${id}`, { method: 'DELETE' });
    await fetchCards();
  };

  const fmt = v => v !== undefined && v !== null && v !== '' ? `$${Number(v).toLocaleString()}` : '—';
  const fmtPct = v => v ? `${(Number(v) * 100).toFixed(1)}%` : '—';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '600', color: 'var(--text-primary)', margin: 0 }}>Rate Cards</h1>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '3px' }}>
            Pricing rates per aircraft — used by the auto-quote system
          </p>
        </div>
        <button onClick={() => openNew()} style={{
          padding: '8px 18px', fontSize: '13px', fontWeight: '600',
          background: 'var(--accent)', color: '#fff', border: 'none',
          borderRadius: '8px', cursor: 'pointer',
        }}>+ Add Rate Card</button>
      </div>

      {fleetTails.length > 0 && cards.length === 0 && !loading && (
        <div style={{ background: 'rgba(79,142,247,0.08)', border: '1px solid rgba(79,142,247,0.2)', borderRadius: '10px', padding: '14px 18px' }}>
          <p style={{ fontSize: '13px', color: 'var(--accent)', margin: '0 0 10px', fontWeight: '500' }}>
            Your fleet has no rate cards yet. Add one for each aircraft:
          </p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {fleetTails.map(tail => (
              <button key={tail} onClick={() => openNew(tail)} style={{
                padding: '6px 14px', fontSize: '13px', fontWeight: '500',
                background: 'var(--accent)', color: '#fff', border: 'none',
                borderRadius: '7px', cursor: 'pointer',
              }}>+ {tail}</button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading...</div>
      ) : cards.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)', background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--border)' }}>
          No rate cards yet. Add one above to enable auto-quoting.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {cards.map(card => (
            <div key={card.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '18px', fontWeight: '700', color: 'var(--accent)' }}>{card.aircraft_tail}</span>
                  {card.aircraft_type && <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{card.aircraft_type}</span>}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => openEdit(card)} style={{ padding: '6px 14px', fontSize: '12px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '7px', color: 'var(--text-secondary)', cursor: 'pointer' }}>Edit</button>
                  <button onClick={() => remove(card.id)} style={{ padding: '6px 14px', fontSize: '12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '7px', color: 'var(--danger)', cursor: 'pointer' }}>Delete</button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0', padding: '4px 0' }}>
                {[
                  ['Hourly Rate', fmt(card.hourly_rate)],
                  ['Surcharge', card.surcharge_pct ? `${Math.round(card.surcharge_pct * 100)}%` : '—'],
                  ['Positioning', fmt(card.positioning_rate)],
                  ['FA Fee', fmt(card.fa_fee)],
                  ['Crew Fee', fmt(card.crew_fee)],
                  ['Landing Fee', fmt(card.landing_fee)],
                  ['Min Hours', card.min_hours || '—'],
                  ['Overnight Fee', fmt(card.overnight_fee)],
                  ['Free Nights', `First ${card.overnight_threshold || 3} nights free`],
                  ['Segment Fee', card.segment_fee_per_pax ? `$${card.segment_fee_per_pax}/leg/pax` : '—'],
                  ['FET Rate', fmtPct(card.fet_rate)],
                  ['Short Leg Fee', fmt(card.short_leg_amount)],
                ].map(([label, value]) => (
                  <div key={label} style={{ padding: '10px 18px' }}>
                    <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 3px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
                    <p style={{ fontSize: '14px', fontWeight: '500', color: 'var(--text-primary)', margin: 0 }}>{value}</p>
                  </div>
                ))}
              </div>
              {card.notes && (
                <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border)' }}>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>{card.notes}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999, padding: '20px',
        }}>
          <div style={{
            background: 'var(--bg-secondary)', border: '1px solid var(--border)',
            borderRadius: '16px', width: '100%', maxWidth: '600px',
            maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ fontSize: '16px', fontWeight: '600', color: 'var(--text-primary)', margin: 0 }}>
                {editing === 'new' ? 'New Rate Card' : `Edit — ${form.aircraft_tail}`}
              </h2>
              <button onClick={cancel} style={{ background: 'none', border: 'none', fontSize: '20px', color: 'var(--text-secondary)', cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{ overflowY: 'auto', padding: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              {FIELDS.map(f => (
                <div key={f.key} style={f.key === 'notes' ? { gridColumn: '1 / -1' } : {}}>
                  <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '5px' }}>
                    {f.label}
                    {f.note && <span style={{ fontSize: '11px', color: 'var(--text-secondary)', opacity: 0.7, marginLeft: '6px' }}>({f.note})</span>}
                  </label>
                  <input
                    type={f.type}
                    value={form[f.key] ?? ''}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    step={f.key === 'fet_rate' ? '0.001' : '1'}
                    style={{
                      width: '100%', padding: '8px 12px', fontSize: '13px',
                      background: 'var(--bg-card)', border: '1px solid var(--border)',
                      borderRadius: '8px', color: 'var(--text-primary)',
                      outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                </div>
              ))}
            </div>

            {msg && (
              <div style={{ margin: '0 20px', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', background: msg.type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)', color: msg.type === 'error' ? 'var(--danger)' : 'var(--success)', border: `1px solid ${msg.type === 'error' ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)'}` }}>
                {msg.text}
              </div>
            )}

            <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button onClick={cancel} style={{ padding: '8px 18px', fontSize: '13px', background: 'transparent', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-secondary)', cursor: 'pointer' }}>Cancel</button>
              <button onClick={save} disabled={saving} style={{ padding: '8px 20px', fontSize: '13px', fontWeight: '600', background: saving ? 'var(--border)' : 'var(--accent)', color: '#fff', border: 'none', borderRadius: '8px', cursor: saving ? 'default' : 'pointer' }}>
                {saving ? 'Saving...' : 'Save Rate Card'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
