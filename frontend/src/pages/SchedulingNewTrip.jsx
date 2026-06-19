import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';

// Known fleet for the aircraft picker (adjust as the fleet changes).
const FLEET = ['N408JS', 'N69FP'];
const blankLeg = () => ({ dep_icao: '', arr_icao: '', dep_time: '', arr_time: '' });

const labelStyle = { fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 };
const inputStyle = { width: '100%', padding: '8px 10px', fontSize: 13, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, boxSizing: 'border-box' };

export default function SchedulingNewTrip() {
  const navigate = useNavigate();
  const [tail, setTail] = useState(FLEET[0]);
  const [customer, setCustomer] = useState('');
  const [tripNumber, setTripNumber] = useState('');
  const [legs, setLegs] = useState([blankLeg()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const updateLeg = (i, field, value) => setLegs((ls) => ls.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)));
  const addLeg = () => setLegs((ls) => [...ls, blankLeg()]);
  const removeLeg = (i) => setLegs((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls));

  const save = async () => {
    setError(null);
    const cleaned = legs.filter((l) => l.dep_icao.trim() && l.arr_icao.trim());
    if (!cleaned.length) { setError('Add at least one leg with a From and To airport.'); return; }
    setBusy(true);
    try {
      const r = await apiFetch('/api/scheduling/trips', {
        method: 'POST',
        body: JSON.stringify({ aircraft_tail: tail, customer_name: customer, trip_number: tripNumber, legs: cleaned }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Create failed (${r.status})`);
      navigate(`/scheduling/trips/${j.id}`);
    } catch (e) { setError(e.message); setBusy(false); }
  };

  return (
    <div style={{ maxWidth: 860 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <button onClick={() => navigate('/scheduling')}
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13 }}>← Scheduling</button>
        <h1 style={{ fontSize: 24, fontWeight: 600, color: 'var(--text-primary)' }}>New Quote</h1>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '12px 16px', color: 'var(--danger)', marginBottom: 16 }}>{error}</div>
      )}

      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 160px' }}>
          <label style={labelStyle}>Aircraft</label>
          <select value={tail} onChange={(e) => setTail(e.target.value)} style={inputStyle}>
            {FLEET.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div style={{ flex: '2 1 220px' }}>
          <label style={labelStyle}>Customer</label>
          <input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Company or client name" style={inputStyle} />
        </div>
        <div style={{ flex: '1 1 140px' }}>
          <label style={labelStyle}>Trip # (optional)</label>
          <input value={tripNumber} onChange={(e) => setTripNumber(e.target.value)} placeholder="auto" style={inputStyle} />
        </div>
      </div>

      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>Legs</div>
        {legs.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 90px' }}><label style={labelStyle}>From</label><input value={l.dep_icao} onChange={(e) => updateLeg(i, 'dep_icao', e.target.value)} placeholder="KFXE" style={inputStyle} /></div>
            <div style={{ flex: '1 1 90px' }}><label style={labelStyle}>To</label><input value={l.arr_icao} onChange={(e) => updateLeg(i, 'arr_icao', e.target.value)} placeholder="KTEB" style={inputStyle} /></div>
            <div style={{ flex: '1 1 180px' }}><label style={labelStyle}>Departure</label><input type="datetime-local" value={l.dep_time} onChange={(e) => updateLeg(i, 'dep_time', e.target.value)} style={inputStyle} /></div>
            <div style={{ flex: '1 1 180px' }}><label style={labelStyle}>Arrival</label><input type="datetime-local" value={l.arr_time} onChange={(e) => updateLeg(i, 'arr_time', e.target.value)} style={inputStyle} /></div>
            <button onClick={() => removeLeg(i)} disabled={legs.length === 1} title="Remove leg"
              style={{ padding: '8px 10px', fontSize: 13, background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 8, cursor: legs.length === 1 ? 'default' : 'pointer' }}>✕</button>
          </div>
        ))}
        <button onClick={addLeg}
          style={{ marginTop: 4, padding: '6px 14px', fontSize: 13, background: 'var(--bg-secondary)', color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>+ Add leg</button>
      </div>

      <button onClick={save} disabled={busy}
        style={{ padding: '10px 24px', fontSize: 14, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
        {busy ? 'Creating…' : 'Create Quote'}
      </button>
    </div>
  );
}
