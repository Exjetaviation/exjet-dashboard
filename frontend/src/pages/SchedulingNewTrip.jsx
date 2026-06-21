import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { useApi } from '../hooks/useApi';
import { distinctClients } from '../lib/schedulingAggregate';
import AirportInput from '../components/AirportInput';

// Known fleet for the aircraft picker (adjust as the fleet changes).
const FLEET = ['N408JS', 'N69FP'];
// Departure date and clock time are captured separately, then composed into a single
// parseable timestamp for the estimate + the create payload.
const blankLeg = () => ({ dep_icao: '', arr_icao: '', dep_date: '', dep_clock: '', pax: '', positioning: false });
const legDateTime = (l) => (l.dep_date ? (l.dep_clock ? `${l.dep_date}T${l.dep_clock}` : l.dep_date) : '');

const labelStyle = { fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 };
const inputStyle = { width: '100%', padding: '8px 10px', fontSize: 13, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, boxSizing: 'border-box' };

// Live distance + flight time for a leg, computed as soon as both airports are in.
function LegEstimate({ dep, arr, depTime }) {
  const [est, setEst] = useState(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const a = (dep || '').trim(), b = (arr || '').trim();
    if (a.length < 3 || b.length < 3) { setEst(null); return; }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const q = new URLSearchParams({ from: a, to: b });
        if (depTime) q.set('dep', new Date(depTime).toISOString());
        const r = await apiFetch(`/api/scheduling/leg-estimate?${q.toString()}`);
        setEst(await r.json());
      } catch { setEst(null); }
      setLoading(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [dep, arr, depTime]);

  if (loading) return <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>calculating…</span>;
  if (!est) return null;
  if (est.distanceNm == null) return <span style={{ fontSize: 11, color: '#f59e0b' }}>airport not found — check the codes</span>;
  const h = Math.floor(est.minutes / 60), m = est.minutes % 60;
  const arr2 = est.arrTime ? ` · arrives ${new Date(est.arrTime).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : '';
  return (
    <span style={{ fontSize: 11, color: 'var(--accent)' }}>
      ≈ {est.distanceNm.toLocaleString()} nm · {h}:{String(m).padStart(2, '0')} ETE{est.source === 'history' ? ' (from history)' : ''}{arr2}
    </span>
  );
}

export default function SchedulingNewTrip() {
  const navigate = useNavigate();
  const [tail, setTail] = useState(FLEET[0]);
  const [customer, setCustomer] = useState('');
  const [tripNumber, setTripNumber] = useState('');
  const [legs, setLegs] = useState([blankLeg()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [addingClient, setAddingClient] = useState(false);
  // Clients we've worked with, derived from the mirror (companies on synced trips).
  const { data: legsData } = useApi('/api/scheduling/legs');
  const clients = distinctClients(legsData?.legs || []);

  const updateLeg = (i, field, value) => setLegs((ls) => ls.map((l, idx) => {
    if (idx === i) return { ...l, [field]: value };
    // Carry a leg's arrival into the next leg's departure when that one is still empty.
    if (field === 'arr_icao' && idx === i + 1 && !l.dep_icao) return { ...l, dep_icao: value };
    return l;
  }));
  // A new leg departs from where the previous leg arrives.
  const addLeg = () => setLegs((ls) => [...ls, { ...blankLeg(), dep_icao: ls[ls.length - 1]?.arr_icao || '' }]);
  const removeLeg = (i) => setLegs((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls));

  const save = async () => {
    setError(null);
    const cleaned = legs
      .filter((l) => l.dep_icao.trim() && l.arr_icao.trim())
      .map((l) => ({ dep_icao: l.dep_icao.trim(), arr_icao: l.arr_icao.trim(), dep_time: legDateTime(l), pax: l.pax, positioning: l.positioning }));
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
        <div style={{ flex: '2 1 240px' }}>
          <label style={labelStyle}>Customer</label>
          {addingClient ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="New client name" autoFocus style={inputStyle} />
              <button type="button" onClick={() => { setAddingClient(false); setCustomer(''); }} title="Choose an existing client"
                style={{ flexShrink: 0, padding: '0 10px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>↩</button>
            </div>
          ) : (
            <select value={customer}
              onChange={(e) => { if (e.target.value === '__new__') { setAddingClient(true); setCustomer(''); } else setCustomer(e.target.value); }}
              style={inputStyle}>
              <option value="">Select a client…</option>
              {clients.map((c) => <option key={c.name} value={c.name}>{c.name}{c.wholesale ? ' · wholesale' : ''}</option>)}
              <option value="__new__">+ Add new client…</option>
            </select>
          )}
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
            <div style={{ flex: '1 1 130px' }}><label style={labelStyle}>From</label><AirportInput value={l.dep_icao} onChange={(v) => updateLeg(i, 'dep_icao', v)} placeholder="code or city" inputStyle={inputStyle} /></div>
            <div style={{ flex: '1 1 130px' }}><label style={labelStyle}>To</label><AirportInput value={l.arr_icao} onChange={(v) => updateLeg(i, 'arr_icao', v)} placeholder="code or city" inputStyle={inputStyle} /></div>
            <div style={{ flex: '1 1 120px' }}><label style={labelStyle}>Date</label><input type="date" value={l.dep_date} onChange={(e) => updateLeg(i, 'dep_date', e.target.value)} style={inputStyle} /></div>
            <div style={{ flex: '0 1 100px' }}><label style={labelStyle}>Time</label><input type="time" value={l.dep_clock} onChange={(e) => updateLeg(i, 'dep_clock', e.target.value)} style={inputStyle} /></div>
            <div style={{ flex: '0 1 70px' }}><label style={labelStyle}>Pax</label><input type="number" min="0" value={l.pax} onChange={(e) => updateLeg(i, 'pax', e.target.value)} placeholder="0" style={inputStyle} /></div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)', paddingBottom: 8 }}><input type="checkbox" checked={l.positioning} onChange={(e) => updateLeg(i, 'positioning', e.target.checked)} /> Ferry</label>
            <button onClick={() => removeLeg(i)} disabled={legs.length === 1} title="Remove leg"
              style={{ padding: '8px 10px', fontSize: 13, background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 8, cursor: legs.length === 1 ? 'default' : 'pointer' }}>✕</button>
            <div style={{ flexBasis: '100%', minHeight: 14 }}>
              <LegEstimate dep={l.dep_icao} arr={l.arr_icao} depTime={legDateTime(l)} />
            </div>
          </div>
        ))}
        <button onClick={addLeg}
          style={{ marginTop: 4, padding: '6px 14px', fontSize: 13, background: 'var(--bg-secondary)', color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>+ Add leg</button>
        <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 10 }}>Arrival times are computed automatically by the flight-time engine (departure + flight time).</p>
      </div>

      <button onClick={save} disabled={busy}
        style={{ padding: '10px 24px', fontSize: 14, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
        {busy ? 'Creating…' : 'Create Quote'}
      </button>
    </div>
  );
}
