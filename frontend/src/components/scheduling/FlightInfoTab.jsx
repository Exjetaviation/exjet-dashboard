import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../lib/api';
import { minutesBetween, minutesToHhmm } from '../../lib/flightTime';

// ── Shared style tokens ──────────────────────────────────────────────────────
const inp = {
  padding: '7px 10px',
  fontSize: 13,
  background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  boxSizing: 'border-box',
  width: '100%',
};

const labelSt = {
  display: 'block',
  fontSize: 11,
  color: 'var(--text-secondary)',
  marginBottom: 4,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

// ── Small helpers ────────────────────────────────────────────────────────────
function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={labelSt}>{label}</label>
      {children}
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
      {title && <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>{title}</div>}
      {children}
    </div>
  );
}

// Datetime-local inputs expect "YYYY-MM-DDTHH:MM" without timezone.
// We treat stored ISO values as UTC and slice them directly — consistent with
// how the rest of the app handles Zulu times (simple + no tz library needed).
function isoToInput(iso) {
  if (!iso) return '';
  return String(iso).slice(0, 16); // "2024-01-15T14:30"
}

function inputToIso(val) {
  if (!val) return null;
  return val + ':00Z'; // "2024-01-15T14:30:00Z"
}

// Build a crew block from a LevelFlight pilot object
function crewBlockFromPilot(pilot) {
  const u = pilot?.user || {};
  return {
    crew_lf_oid: u?._id?.$oid || u?.id || '',
    name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || '',
    performed_takeoff: false,
    performed_landing: false,
    imc_hours: '',
    night_hours: '',
  };
}

function blankCrewBlock() {
  return { crew_lf_oid: '', name: '', performed_takeoff: false, performed_landing: false, imc_hours: '', night_hours: '' };
}

const BLANK_FORM = {
  out_at: '', off_at: '', on_at: '', in_at: '',
  takeoff_tod: 'day', landing_tod: 'day',
  fuel_start_lbs: '', fuel_stop_lbs: '',
  apu_start: '', apu_stop: '', apu_end_cycles: '',
  engine_1_oil_pints: '', engine_2_oil_pints: '',
  delay_reason: '',
  approach_type: 'visual',
  debrief_category: 'summary',
  debrief_notes: '',
  pic: blankCrewBlock(),
  sic: blankCrewBlock(),
};

// ── Main component ───────────────────────────────────────────────────────────
export default function FlightInfoTab({ legs }) {
  const [legIdx, setLegIdx] = useState(0);
  const [form, setForm] = useState(BLANK_FORM);
  const [fiStatus, setFiStatus] = useState('draft');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  const [error, setError] = useState(null);

  const selectedLeg = legs?.[legIdx] || null;
  const legId = selectedLeg?._id?.$oid || null;

  // ── Load flight-info from backend ─────────────────────────────────────────
  const load = useCallback(async () => {
    if (!legId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await apiFetch(`/api/scheduling/legs/${legId}/flight-info`);
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `Failed to load (${r.status})`);
      }
      const j = await r.json();
      const fi = j.flight_info || j;

      // Crew: prefer saved flight_info_crew; fall back to leg.pilots
      const pilots = selectedLeg?.pilots || [];
      const picPilot = pilots.find((p) => p.seat === 2) || null;
      const sicPilot = pilots.find((p) => p.seat === 3) || null;

      const crewArr = fi.flight_info_crew || [];
      const picSaved = crewArr.find((c) => c.role === 'PIC');
      const sicSaved = crewArr.find((c) => c.role === 'SIC');

      const buildSavedBlock = (saved) => ({
        crew_lf_oid: saved.crew_lf_oid || '',
        name: saved.name || '',
        performed_takeoff: !!saved.performed_takeoff,
        performed_landing: !!saved.performed_landing,
        imc_hours: saved.imc_hours ?? '',
        night_hours: saved.night_hours ?? '',
      });

      setFiStatus(fi.status || 'draft');
      setForm({
        out_at: isoToInput(fi.out_at),
        off_at: isoToInput(fi.off_at),
        on_at: isoToInput(fi.on_at),
        in_at: isoToInput(fi.in_at),
        takeoff_tod: fi.takeoff_tod || 'day',
        landing_tod: fi.landing_tod || 'day',
        fuel_start_lbs: fi.fuel_start_lbs ?? '',
        fuel_stop_lbs: fi.fuel_stop_lbs ?? '',
        apu_start: fi.apu_start ?? '',
        apu_stop: fi.apu_stop ?? '',
        apu_end_cycles: fi.apu_end_cycles ?? '',
        engine_1_oil_pints: fi.engine_1_oil_pints ?? '',
        engine_2_oil_pints: fi.engine_2_oil_pints ?? '',
        delay_reason: fi.delay_reason || '',
        approach_type: fi.approach_type || 'visual',
        debrief_category: fi.debrief?.[0]?.category || 'summary',
        debrief_notes: fi.debrief?.[0]?.notes || '',
        pic: picSaved ? buildSavedBlock(picSaved) : crewBlockFromPilot(picPilot),
        sic: sicSaved ? buildSavedBlock(sicSaved) : crewBlockFromPilot(sicPilot),
      });
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [legId, selectedLeg]);

  useEffect(() => { load(); }, [load]);

  // ── Field setters ──────────────────────────────────────────────────────────
  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));
  const setPilot = (role, key, val) => setForm((f) => ({ ...f, [role]: { ...f[role], [key]: val } }));

  // ── Save (PUT) ─────────────────────────────────────────────────────────────
  const save = async () => {
    if (!legId) return;
    setBusy(true);
    setError(null);
    setSaveMsg(null);
    try {
      const numOrNull = (v) => (v === '' || v == null ? null : Number(v));
      const crewBlocks = [
        { role: 'PIC', ...form.pic },
        { role: 'SIC', ...form.sic },
      ]
        .filter((c) => c.crew_lf_oid)
        .map((c) => ({
          role: c.role,
          crew_lf_oid: c.crew_lf_oid,
          performed_takeoff: !!c.performed_takeoff,
          performed_landing: !!c.performed_landing,
          imc_hours: numOrNull(c.imc_hours),
          night_hours: numOrNull(c.night_hours),
        }));

      const body = {
        out_at: inputToIso(form.out_at),
        off_at: inputToIso(form.off_at),
        on_at: inputToIso(form.on_at),
        in_at: inputToIso(form.in_at),
        takeoff_tod: form.takeoff_tod,
        landing_tod: form.landing_tod,
        fuel_start_lbs: numOrNull(form.fuel_start_lbs),
        fuel_stop_lbs: numOrNull(form.fuel_stop_lbs),
        apu_start: numOrNull(form.apu_start),
        apu_stop: numOrNull(form.apu_stop),
        apu_end_cycles: numOrNull(form.apu_end_cycles),
        engine_1_oil_pints: numOrNull(form.engine_1_oil_pints),
        engine_2_oil_pints: numOrNull(form.engine_2_oil_pints),
        delay_reason: form.delay_reason || null,
        approach_type: form.approach_type,
        debrief: form.debrief_notes ? [{ category: form.debrief_category, notes: form.debrief_notes }] : [],
        crew: crewBlocks,
      };

      const r = await apiFetch(`/api/scheduling/legs/${legId}/flight-info`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `Save failed (${r.status})`);
      }
      setSaveMsg('Saved');
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  // ── Mark Complete (POST) ───────────────────────────────────────────────────
  const markComplete = async () => {
    if (!legId) return;
    if (!window.confirm('Mark this flight info as complete? This triggers component-time accrual.')) return;
    setBusy(true);
    setError(null);
    setSaveMsg(null);
    try {
      const r = await apiFetch(`/api/scheduling/legs/${legId}/flight-info/complete`, { method: 'POST' });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `Failed (${r.status})`);
      }
      await load();
      setSaveMsg('Completed');
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  // ── Guard: no legs ─────────────────────────────────────────────────────────
  if (!legs || legs.length === 0) {
    return <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No legs available for this trip.</p>;
  }

  // ── Live computed times (treat form values as UTC) ─────────────────────────
  const toFull = (v) => (v ? v + ':00Z' : null);
  const actualFlight = minutesToHhmm(minutesBetween(toFull(form.off_at), toFull(form.on_at)));
  const actualBlock = minutesToHhmm(minutesBetween(toFull(form.out_at), toFull(form.in_at)));

  return (
    <div style={{ maxWidth: 600 }}>
      {/* Leg selector — only shown when trip has >1 leg */}
      {legs.length > 1 && (
        <div style={{ marginBottom: 16 }}>
          <label style={labelSt}>Leg</label>
          <select
            value={legIdx}
            onChange={(e) => { setLegIdx(Number(e.target.value)); setSaveMsg(null); setError(null); }}
            style={inp}
          >
            {legs.map((l, i) => (
              <option key={i} value={i}>
                {l.departure?.airport || '?'} → {l.arrival?.airport || '?'}
              </option>
            ))}
          </select>
        </div>
      )}

      {loading && <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Loading…</p>}

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', color: 'var(--danger)', marginBottom: 14, fontSize: 13 }}>
          {error}
        </div>
      )}

      {fiStatus === 'complete' && (
        <div style={{ display: 'inline-block', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8, padding: '6px 14px', color: '#22c55e', marginBottom: 14, fontSize: 12, fontWeight: 600 }}>
          Completed
        </div>
      )}

      {/* ── OOOI ─────────────────────────────────────────────────────── */}
      <Card title="OOOI Times (UTC)">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Out">
            <input type="datetime-local" style={inp} value={form.out_at} onChange={(e) => set('out_at', e.target.value)} />
          </Field>
          <Field label="Off">
            <input type="datetime-local" style={inp} value={form.off_at} onChange={(e) => set('off_at', e.target.value)} />
          </Field>
          <Field label="On">
            <input type="datetime-local" style={inp} value={form.on_at} onChange={(e) => set('on_at', e.target.value)} />
          </Field>
          <Field label="In">
            <input type="datetime-local" style={inp} value={form.in_at} onChange={(e) => set('in_at', e.target.value)} />
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 24, marginTop: 8, fontSize: 13, color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
          <span>Actual Flight: <strong style={{ color: 'var(--text-primary)' }}>{actualFlight || '—'}</strong></span>
          <span>Actual Block: <strong style={{ color: 'var(--text-primary)' }}>{actualBlock || '—'}</strong></span>
        </div>
      </Card>

      {/* ── Time of Day ──────────────────────────────────────────────── */}
      <Card title="Time of Day">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Takeoff">
            <select style={inp} value={form.takeoff_tod} onChange={(e) => set('takeoff_tod', e.target.value)}>
              <option value="day">Day</option>
              <option value="night">Night</option>
            </select>
          </Field>
          <Field label="Landing">
            <select style={inp} value={form.landing_tod} onChange={(e) => set('landing_tod', e.target.value)}>
              <option value="day">Day</option>
              <option value="night">Night</option>
            </select>
          </Field>
        </div>
      </Card>

      {/* ── Fuel ─────────────────────────────────────────────────────── */}
      <Card title="Fuel">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Start (lbs)">
            <input type="number" style={inp} value={form.fuel_start_lbs} onChange={(e) => set('fuel_start_lbs', e.target.value)} placeholder="0" min="0" />
          </Field>
          <Field label="Stop (lbs)">
            <input type="number" style={inp} value={form.fuel_stop_lbs} onChange={(e) => set('fuel_stop_lbs', e.target.value)} placeholder="0" min="0" />
          </Field>
        </div>
      </Card>

      {/* ── APU ──────────────────────────────────────────────────────── */}
      <Card title="APU">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <Field label="Start">
            <input type="number" style={inp} value={form.apu_start} onChange={(e) => set('apu_start', e.target.value)} placeholder="0" min="0" />
          </Field>
          <Field label="Stop">
            <input type="number" style={inp} value={form.apu_stop} onChange={(e) => set('apu_stop', e.target.value)} placeholder="0" min="0" />
          </Field>
          <Field label="End Cycles">
            <input type="number" style={inp} value={form.apu_end_cycles} onChange={(e) => set('apu_end_cycles', e.target.value)} placeholder="0" min="0" />
          </Field>
        </div>
      </Card>

      {/* ── Oil ──────────────────────────────────────────────────────── */}
      <Card title="Oil">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Engine 1 (pints)">
            <input type="number" style={inp} value={form.engine_1_oil_pints} onChange={(e) => set('engine_1_oil_pints', e.target.value)} placeholder="0" min="0" step="0.1" />
          </Field>
          <Field label="Engine 2 (pints)">
            <input type="number" style={inp} value={form.engine_2_oil_pints} onChange={(e) => set('engine_2_oil_pints', e.target.value)} placeholder="0" min="0" step="0.1" />
          </Field>
        </div>
      </Card>

      {/* ── Flight Details ────────────────────────────────────────────── */}
      <Card title="Flight Details">
        <Field label="Delay Reason">
          <input style={inp} value={form.delay_reason} onChange={(e) => set('delay_reason', e.target.value)} placeholder="None" />
        </Field>
        <Field label="Approach Type">
          <select style={inp} value={form.approach_type} onChange={(e) => set('approach_type', e.target.value)}>
            <option value="precision">Precision</option>
            <option value="non_precision">Non-Precision</option>
            <option value="visual">Visual</option>
          </select>
        </Field>
      </Card>

      {/* ── Crew blocks (PIC / SIC) ───────────────────────────────────── */}
      {['pic', 'sic'].map((role) => (
        <Card key={role} title={role.toUpperCase()}>
          {form[role].name && (
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
              {form[role].name}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="IMC Hours">
              <input type="number" style={inp} value={form[role].imc_hours} onChange={(e) => setPilot(role, 'imc_hours', e.target.value)} placeholder="0" min="0" step="0.1" />
            </Field>
            <Field label="Night Hours">
              <input type="number" style={inp} value={form[role].night_hours} onChange={(e) => setPilot(role, 'night_hours', e.target.value)} placeholder="0" min="0" step="0.1" />
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!form[role].performed_takeoff}
                onChange={(e) => setPilot(role, 'performed_takeoff', e.target.checked)}
                style={{ accentColor: 'var(--accent)' }}
              />
              Performed Takeoff
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!form[role].performed_landing}
                onChange={(e) => setPilot(role, 'performed_landing', e.target.checked)}
                style={{ accentColor: 'var(--accent)' }}
              />
              Performed Landing
            </label>
          </div>
        </Card>
      ))}

      {/* ── Debrief ──────────────────────────────────────────────────── */}
      <Card title="Debrief">
        <Field label="Category">
          <select style={inp} value={form.debrief_category} onChange={(e) => set('debrief_category', e.target.value)}>
            <option value="summary">Summary</option>
            <option value="operations">Operations</option>
            <option value="maintenance">Maintenance</option>
            <option value="catering">Catering</option>
            <option value="passenger">Passenger</option>
          </select>
        </Field>
        <Field label="Notes">
          <textarea
            style={{ ...inp, minHeight: 80, resize: 'vertical' }}
            value={form.debrief_notes}
            onChange={(e) => set('debrief_notes', e.target.value)}
            placeholder="Post-flight debrief notes…"
          />
        </Field>
      </Card>

      {/* ── Action buttons ────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 32 }}>
        <button
          onClick={save}
          disabled={busy || !legId}
          style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: busy || !legId ? 'default' : 'pointer', fontSize: 13, fontWeight: 600, opacity: busy || !legId ? 0.6 : 1 }}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        {fiStatus !== 'complete' && (
          <button
            onClick={markComplete}
            disabled={busy || !legId}
            style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8, padding: '8px 20px', cursor: busy || !legId ? 'default' : 'pointer', fontSize: 13, fontWeight: 600, opacity: busy || !legId ? 0.6 : 1 }}
          >
            Mark Complete
          </button>
        )}
        {saveMsg && <span style={{ fontSize: 12, color: '#22c55e', fontWeight: 600 }}>{saveMsg}</span>}
      </div>
    </div>
  );
}
