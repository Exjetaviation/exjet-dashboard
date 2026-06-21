import { useEffect, useState, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { apiFetch, API_BASE } from '../lib/api';
import FlightsList from '../components/FlightsList';
import { distinctCrew, distinctClients } from '../lib/schedulingAggregate';
import { useApi } from '../hooks/useApi';

const FLEET = ['N408JS', 'N69FP'];
const blankLeg = () => ({ dep_icao: '', arr_icao: '', dep_time: '', pax: '', positioning: false });
const toLocalInput = (ms) => { if (!ms) return ''; const d = new Date(ms); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const inp = { padding: '7px 10px', fontSize: 13, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, boxSizing: 'border-box' };

// Action buttons come from the backend (the valid next actions for the trip's
// current stage: Quote→Book→Release, with Cancel until closed). "Release" also makes
// the Crew Trip Sheet available; a released trip auto-closes once the flight is done.
const ACTION_COLOR = { book: '#a855f7', release: '#3b82f6', cancel: '#ef4444' };
const usd = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString());

// Reprice from editable RATE inputs (LevelFlight-style: edit the hourly rate / fees,
// not the dollar totals). Mirrors the backend recomputeFromInputs.
const recomputeInputs = (i) => {
  const n = (v) => Number(v) || 0;
  const flightCost = Math.round(n(i.hourlyRate) * n(i.hours));
  const surcharge = Math.round(n(i.surchargePerHr) * n(i.hours));
  const faCost = Math.round(n(i.faFee) * n(i.faCount));
  const crewCost = Math.round(n(i.crewFee) * n(i.crewCount));
  const landingCost = Math.round(n(i.landingFee) * n(i.landings));
  const overnightCost = Math.round(n(i.overnightCost));
  const segmentFee = Math.round(n(i.segmentPerPax) * n(i.pax));
  const fetBase = flightCost + surcharge + landingCost + faCost + crewCost + overnightCost;
  const fetAmount = Math.round(fetBase * (Number(i.fetRate) || 0));
  return { flightCost, surcharge, faCost, crewCost, landingCost, overnightCost, segmentFee, fetAmount, total: Math.round(fetBase + segmentFee + fetAmount) };
};
const HIDE = new Set(['aircraft']);
const ROLE_COLOR = { PIC: '#f59e0b', SIC: '#4f8ef7', Cabin: '#22c55e' };

// A titled card section (LevelFlight-style trip-detail blocks).
function Section({ title, right, children }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

export default function SchedulingTripDetail() {
  const { id } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();
  const stateTrip = state?.trip && state.trip.dispatchId === id ? state.trip : null; // fast-path hydration
  const [meta, setMeta] = useState(null);   // status + provenance from the backend
  const [legs, setLegs] = useState([]);     // legs from the mirror (survives refresh)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [priceEdit, setPriceEdit] = useState(null); // draft line amounts when editing the breakdown
  const [crewEdit, setCrewEdit] = useState(null);   // draft crew assignment when editing
  const [detailsEdit, setDetailsEdit] = useState(null); // draft aircraft/customer/legs when editing
  const [passengers, setPassengers] = useState([]);     // saved manifest
  const [paxEdit, setPaxEdit] = useState(null);         // draft manifest when editing
  const [documents, setDocuments] = useState([]);       // uploaded trip documents
  const [docType, setDocType] = useState('contract');
  const [docBusy, setDocBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/scheduling/trips/${id}`);
      const j = await r.json();
      if (j.trip) { setMeta(j.trip); setLegs(j.legs || []); }
      else setError(j.error || 'Trip not found');
    } catch (e) { setError(e.message); }
  }, [id]);

  const loadPassengers = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/scheduling/trips/${id}/passengers`);
      const j = await r.json();
      if (j.passengers) setPassengers(j.passengers);
    } catch { /* soft */ }
  }, [id]);

  const loadDocuments = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/scheduling/trips/${id}/documents`);
      const j = await r.json();
      if (j.documents) setDocuments(j.documents);
    } catch { /* soft */ }
  }, [id]);

  useEffect(() => { load(); loadPassengers(); loadDocuments(); }, [load, loadPassengers, loadDocuments]);

  const uploadDoc = async (file, passengerId = null) => {
    if (!file) return;
    setDocBusy(true); setError(null);
    try {
      const data_base64 = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(',')[1]);
        fr.onerror = reject;
        fr.readAsDataURL(file);
      });
      const r = await apiFetch(`/api/scheduling/trips/${id}/documents`, {
        method: 'POST',
        body: JSON.stringify({ name: file.name, doc_type: passengerId ? 'passenger_id' : docType, content_type: file.type, data_base64, passenger_id: passengerId }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `Upload failed (${r.status})`); }
      await loadDocuments();
    } catch (e) { setError(e.message); }
    setDocBusy(false);
  };
  const deleteDoc = async (docId) => {
    setDocBusy(true); setError(null);
    try {
      const r = await apiFetch(`/api/scheduling/documents/${docId}`, { method: 'DELETE' });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `Delete failed (${r.status})`); }
      await loadDocuments();
    } catch (e) { setError(e.message); }
    setDocBusy(false);
  };

  const setStatus = async (status) => {
    setBusy(true); setError(null);
    try {
      const r = await apiFetch(`/api/scheduling/trips/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `Update failed (${r.status})`); }
      await load();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const revert = async () => {
    setBusy(true); setError(null);
    try {
      const r = await apiFetch(`/api/scheduling/trips/${id}/revert`, { method: 'POST' });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `Revert failed (${r.status})`); }
      await load();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const reprice = async () => {
    setBusy(true); setError(null);
    try {
      const r = await apiFetch(`/api/scheduling/trips/${id}/price`, { method: 'POST', body: JSON.stringify({}) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `Pricing failed (${r.status})`); }
      await load();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const startPriceEdit = () => {
    const p = meta?.pricing || {};
    const hours = p.hours ?? p.totalHrs ?? 0;
    const per = (rate, cost, qty) => (rate ?? (qty > 0 ? Math.round((cost || 0) / qty) : 0)); // derive rate for older quotes
    setPriceEdit({
      hourlyRate: per(p.hourlyRate, p.flightCost, hours), hours, surchargePerHr: per(p.surchargePerHr, p.surcharge, hours),
      faFee: per(p.faFee, p.faCost, p.faCount), faCount: p.faCount || 0,
      crewFee: per(p.crewFee, p.crewCost, p.crewCount), crewCount: p.crewCount || 0,
      landingFee: per(p.landingFee, p.landingCost, p.landings), landings: p.landings || 0,
      segmentPerPax: per(p.segmentPerPax, p.segmentFee, p.pax), pax: p.pax || 0,
      overnightCost: p.overnightCost || 0, fetRate: p.fetRate || 0,
    });
  };
  const savePrice = async () => {
    setBusy(true); setError(null);
    try {
      const r = await apiFetch(`/api/scheduling/trips/${id}/price-lines`, { method: 'PATCH', body: JSON.stringify(priceEdit) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `Save failed (${r.status})`); }
      setPriceEdit(null);
      await load();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  // Legs: prefer the mirror response; fall back to router state during the first paint.
  const legsForView = legs.length ? legs : (stateTrip?.legs || []);
  const tail = stateTrip?.tail || legsForView[0]?.dispatch?.aircraft?.tailNumber || null;
  const client = stateTrip?.client || legsForView[0]?.dispatch?.client?.company?.name || null;
  const airports = legsForView.length
    ? legsForView.flatMap((l, i) => (i === 0 ? [l.departure?.airport, l.arrival?.airport] : [l.arrival?.airport])).filter(Boolean)
    : [];
  const routeSummary = stateTrip?.routeSummary || (airports.length ? airports.join(' → ') : null);
  const title = routeSummary || (meta?.trip_number ? `Trip #${meta.trip_number}` : 'Trip');
  const subtitle = [meta?.trip_number ? `Trip #${meta.trip_number}` : null, tail, client].filter(Boolean).join(' · ');
  const released = meta?.status === 'released';
  const crew = distinctCrew(legsForView);
  const pax = legsForView.reduce((m, l) => Math.max(m, l.passengerCount || 0), 0);

  // Crew assignment editor (per-trip PIC / SIC / FA from the full crew roster).
  const { data: rosterData } = useApi('/api/scheduling/crew-roster');
  const roster = rosterData?.crew || [];
  const pilotRoster = roster.filter((c) => c.role !== 'Cabin');
  const cabinRoster = roster.filter((c) => c.role === 'Cabin');
  const crewKey = (u) => (u?.email || [u?.firstName, u?.lastName].filter(Boolean).join(' ') || '');
  const legPilots = legsForView[0]?.pilots || [];
  const curCrew = {
    pic: legPilots.find((p) => p.seat === 2)?.user || null,
    sic: legPilots.find((p) => p.seat === 3)?.user || null,
    fa: (legsForView[0]?.attendants || [])[0]?.user || null,
  };
  // Passenger manifest editor (with autocomplete from previous passengers).
  const { data: paxSuggestData } = useApi('/api/scheduling/passengers/suggest');
  const paxSuggestions = paxSuggestData?.passengers || [];
  const blankPax = () => ({ name: '', weight_lbs: '', dob: '', note: '' });
  const startPaxEdit = () => setPaxEdit(passengers.length ? passengers.map((p) => ({ id: p.id, name: p.name || '', weight_lbs: p.weight_lbs ?? '', dob: p.dob || '', note: p.note || '' })) : [blankPax()]);
  const updatePax = (i, field, v) => setPaxEdit((d) => d.map((p, idx) => (idx === i ? { ...p, [field]: v } : p)));
  const addPax = () => setPaxEdit((d) => [...d, blankPax()]);
  const removePax = (i) => setPaxEdit((d) => d.filter((_, idx) => idx !== i));
  // Picking a known name fills in their DOB/weight from history.
  const onPaxName = (i, name) => {
    const known = paxSuggestions.find((p) => p.name === name);
    setPaxEdit((d) => d.map((p, idx) => (idx === i ? { ...p, name, dob: known?.dob || p.dob, weight_lbs: known?.weight_lbs ?? p.weight_lbs } : p)));
  };
  const savePax = async () => {
    setBusy(true); setError(null);
    try {
      const r = await apiFetch(`/api/scheduling/trips/${id}/passengers`, { method: 'PUT', body: JSON.stringify({ passengers: paxEdit }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Save failed (${r.status})`);
      setPassengers(j.passengers || []);
      setPaxEdit(null);
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  // Trip details editor (aircraft / customer / legs) — native trips only.
  const { data: allLegsData } = useApi('/api/scheduling/legs');
  const clientOptions = distinctClients(allLegsData?.legs || []);
  const isNative = meta?.origin === 'native';
  const startDetailsEdit = () => setDetailsEdit({
    aircraft_tail: tail || FLEET[0],
    customer_name: client || '',
    legs: (legsForView.length ? legsForView : [{}]).map((l) => ({
      dep_icao: l.departure?.airport || '', arr_icao: l.arrival?.airport || '',
      dep_time: toLocalInput(l.departure?.time), pax: l.passengerCount || '', positioning: !!l.isPositioning,
    })),
  });
  const updateEditLeg = (i, field, v) => setDetailsEdit((d) => ({ ...d, legs: d.legs.map((l, idx) => (idx === i ? { ...l, [field]: v } : l)) }));
  const addEditLeg = () => setDetailsEdit((d) => ({ ...d, legs: [...d.legs, blankLeg()] }));
  const removeEditLeg = (i) => setDetailsEdit((d) => ({ ...d, legs: d.legs.length > 1 ? d.legs.filter((_, idx) => idx !== i) : d.legs }));
  const saveDetails = async () => {
    setError(null);
    const legs = detailsEdit.legs.filter((l) => l.dep_icao.trim() && l.arr_icao.trim());
    if (!legs.length) { setError('Add at least one leg with a From and To.'); return; }
    setBusy(true);
    try {
      const r = await apiFetch(`/api/scheduling/trips/${id}/details`, {
        method: 'PATCH',
        body: JSON.stringify({ aircraft_tail: detailsEdit.aircraft_tail, customer_name: detailsEdit.customer_name, legs }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `Save failed (${r.status})`); }
      setDetailsEdit(null);
      await load();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const startCrewEdit = () => setCrewEdit({ pic: crewKey(curCrew.pic), sic: crewKey(curCrew.sic), fa: crewKey(curCrew.fa) });
  const saveCrew = async () => {
    setBusy(true); setError(null);
    try {
      const byKey = (k) => roster.find((p) => crewKey(p) === k) || null;
      const body = { pic: byKey(crewEdit.pic), sic: byKey(crewEdit.sic), fa: byKey(crewEdit.fa) };
      const r = await apiFetch(`/api/scheduling/trips/${id}/crew`, { method: 'PATCH', body: JSON.stringify(body) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `Save failed (${r.status})`); }
      setCrewEdit(null);
      await load();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/scheduling')}
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13 }}>← Scheduling</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{subtitle}</p>
        </div>
        {isNative && detailsEdit == null && (
          <button onClick={startDetailsEdit} disabled={busy}
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 13 }}>✎ Edit trip</button>
        )}
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '12px 16px', color: 'var(--danger)', marginBottom: 16 }}>{error}</div>
      )}

      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Status</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 20, padding: '4px 12px' }}>
            {meta?.status_label || '—'}
          </span>
          {meta?.locally_modified && meta?.origin === 'levelflight' && (
            <>
              <span style={{ fontSize: 12, color: '#f59e0b', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 20, padding: '3px 10px' }}>
                Edited locally · LevelFlight: {meta.original_status_label}
              </span>
              <button onClick={revert} disabled={busy}
                style={{ padding: '6px 12px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>⟲ Revert to LevelFlight</button>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {(meta?.actions || []).map((a) => (
            <button key={a.action} onClick={() => setStatus(a.status)} disabled={busy || !meta}
              style={{ padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
                background: ACTION_COLOR[a.action] || 'var(--accent)', color: '#fff',
                border: 'none', borderRadius: 8, opacity: busy ? 0.6 : 1 }}>
              {a.label}
            </button>
          ))}
          {meta?.stage === 'closed' && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>This trip is closed.</span>}
          {meta?.stage === 'cancelled' && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>This trip is cancelled.</span>}
          {released && (
            <>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>· Closes automatically once the flight is complete.</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 6, paddingLeft: 12, borderLeft: '1px solid var(--border)' }}>
                <a href={`${API_BASE}/tripsheet/${id}`} target="_blank" rel="noopener noreferrer"
                  style={{ padding: '6px 12px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, textDecoration: 'none' }}>Crew Trip Sheet ↗</a>
              </div>
            </>
          )}
        </div>
      </div>

      {meta?.pricing && (meta.pricing.error ? (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{meta.pricing.error}</span>
          <button onClick={reprice} disabled={busy} style={{ padding: '6px 12px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>↻ Re-price</button>
        </div>
      ) : (() => {
        const p = meta.pricing;
        const editing = priceEdit != null;
        const fetRate = p.fetRate || 0;
        const live = editing ? recomputeInputs(priceEdit) : p;
        const btn = { padding: '6px 12px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' };
        const ni = (key, w = 78) => (
          <input type="number" value={priceEdit[key]} onChange={(e) => setPriceEdit((d) => ({ ...d, [key]: e.target.value }))}
            style={{ width: w, textAlign: 'right', padding: '2px 5px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 5 }} />
        );
        return (
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Quote — {usd(live.total)}{p.manual && !editing ? ' · adjusted' : ''}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                {editing ? (
                  <>
                    <button onClick={savePrice} disabled={busy} style={{ ...btn, background: 'var(--accent)', color: '#fff', border: 'none', fontWeight: 600 }}>Save</button>
                    <button onClick={() => setPriceEdit(null)} disabled={busy} style={btn}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button onClick={startPriceEdit} style={btn}>✎ Edit</button>
                    <button onClick={reprice} disabled={busy} style={btn}>↻ Re-price</button>
                  </>
                )}
              </div>
            </div>
            <table style={{ width: '100%', fontSize: 13, color: 'var(--text-secondary)', borderCollapse: 'collapse' }}>
              <tbody>
                {!editing && p.perLeg?.map((l, i) => (
                  <tr key={i}><td style={{ padding: '3px 0' }}>{l.from} → {l.to} · {l.hrs}h{l.source === 'estimate' ? ' (est)' : l.source === 'unknown-airport' ? ' (no coords)' : ''}</td><td style={{ textAlign: 'right' }}>{usd(l.cost)}</td></tr>
                ))}
                {editing ? (
                  <>
                    <tr><td style={{ padding: '4px 0' }}>Flight · {ni('hourlyRate')}/hr × {ni('hours', 54)} h</td><td style={{ textAlign: 'right' }}>{usd(live.flightCost)}</td></tr>
                    <tr><td style={{ padding: '4px 0' }}>Fuel surcharge · {ni('surchargePerHr')}/hr</td><td style={{ textAlign: 'right' }}>{usd(live.surcharge)}</td></tr>
                    <tr><td style={{ padding: '4px 0' }}>FA · {ni('faFee')} × {ni('faCount', 46)}</td><td style={{ textAlign: 'right' }}>{usd(live.faCost)}</td></tr>
                    <tr><td style={{ padding: '4px 0' }}>Crew · {ni('crewFee')} × {ni('crewCount', 46)}</td><td style={{ textAlign: 'right' }}>{usd(live.crewCost)}</td></tr>
                    <tr><td style={{ padding: '4px 0' }}>Landings · {ni('landingFee')} × {ni('landings', 46)}</td><td style={{ textAlign: 'right' }}>{usd(live.landingCost)}</td></tr>
                    <tr><td style={{ padding: '4px 0' }}>Overnight · {ni('overnightCost')}</td><td style={{ textAlign: 'right' }}>{usd(live.overnightCost)}</td></tr>
                    <tr><td style={{ padding: '4px 0' }}>Segment · {ni('segmentPerPax')}/pax × {ni('pax', 46)}</td><td style={{ textAlign: 'right' }}>{usd(live.segmentFee)}</td></tr>
                  </>
                ) : (
                  <>
                    <tr><td style={{ padding: '3px 0' }}>Flight cost</td><td style={{ textAlign: 'right' }}>{usd(p.flightCost)}</td></tr>
                    {p.surcharge > 0 && <tr><td>Fuel surcharge</td><td style={{ textAlign: 'right' }}>{usd(p.surcharge)}</td></tr>}
                    {p.landingCost > 0 && <tr><td>Landings ({p.landings})</td><td style={{ textAlign: 'right' }}>{usd(p.landingCost)}</td></tr>}
                    {p.faCost > 0 && <tr><td>FA ({p.faCount})</td><td style={{ textAlign: 'right' }}>{usd(p.faCost)}</td></tr>}
                    {p.crewCost > 0 && <tr><td>Crew ({p.crewCount})</td><td style={{ textAlign: 'right' }}>{usd(p.crewCost)}</td></tr>}
                    {p.overnightCost > 0 && <tr><td>Overnights ({p.billableNights})</td><td style={{ textAlign: 'right' }}>{usd(p.overnightCost)}</td></tr>}
                    {p.segmentFee > 0 && <tr><td>Segment fees</td><td style={{ textAlign: 'right' }}>{usd(p.segmentFee)}</td></tr>}
                  </>
                )}
                <tr><td>FET ({Math.round(fetRate * 1000) / 10}%)</td><td style={{ textAlign: 'right' }}>{usd(live.fetAmount)}</td></tr>
                <tr><td style={{ paddingTop: 6, fontWeight: 700, color: 'var(--text-primary)' }}>Total</td><td style={{ paddingTop: 6, textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }}>{usd(live.total)}</td></tr>
              </tbody>
            </table>
            {editing && <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 8 }}>Adjust any charge — FET and total update automatically. "Re-price" reverts to the rate-card calculation.</p>}
          </div>
        );
      })())}

      {detailsEdit != null ? (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--accent)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Edit trip</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={saveDetails} disabled={busy} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Save</button>
              <button onClick={() => setDetailsEdit(null)} disabled={busy} style={{ padding: '6px 14px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
            <div style={{ flex: '1 1 150px' }}>
              <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Aircraft</label>
              <select value={detailsEdit.aircraft_tail} onChange={(e) => setDetailsEdit((d) => ({ ...d, aircraft_tail: e.target.value }))} style={{ ...inp, width: '100%' }}>
                {FLEET.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div style={{ flex: '2 1 220px' }}>
              <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Customer</label>
              <input list="trip-clients" value={detailsEdit.customer_name} onChange={(e) => setDetailsEdit((d) => ({ ...d, customer_name: e.target.value }))} placeholder="Company or client" style={{ ...inp, width: '100%' }} />
              <datalist id="trip-clients">{clientOptions.map((c) => <option key={c.name} value={c.name} />)}</datalist>
            </div>
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>Legs</div>
          {detailsEdit.legs.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 8, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 80px' }}><label style={{ fontSize: 10, color: 'var(--text-secondary)' }}>From</label><input value={l.dep_icao} onChange={(e) => updateEditLeg(i, 'dep_icao', e.target.value)} placeholder="KFXE" style={{ ...inp, width: '100%' }} /></div>
              <div style={{ flex: '1 1 80px' }}><label style={{ fontSize: 10, color: 'var(--text-secondary)' }}>To</label><input value={l.arr_icao} onChange={(e) => updateEditLeg(i, 'arr_icao', e.target.value)} placeholder="KTEB" style={{ ...inp, width: '100%' }} /></div>
              <div style={{ flex: '1 1 180px' }}><label style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Departure</label><input type="datetime-local" value={l.dep_time} onChange={(e) => updateEditLeg(i, 'dep_time', e.target.value)} style={{ ...inp, width: '100%' }} /></div>
              <div style={{ flex: '0 1 64px' }}><label style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Pax</label><input type="number" min="0" value={l.pax} onChange={(e) => updateEditLeg(i, 'pax', e.target.value)} placeholder="0" style={{ ...inp, width: '100%' }} /></div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-secondary)', paddingBottom: 8 }}><input type="checkbox" checked={l.positioning} onChange={(e) => updateEditLeg(i, 'positioning', e.target.checked)} /> Ferry</label>
              <button onClick={() => removeEditLeg(i)} disabled={detailsEdit.legs.length === 1} title="Remove leg" style={{ padding: '7px 9px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 8, cursor: detailsEdit.legs.length === 1 ? 'default' : 'pointer' }}>✕</button>
            </div>
          ))}
          <button onClick={addEditLeg} style={{ marginTop: 2, padding: '5px 12px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>+ Add leg</button>
          <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 10 }}>Arrivals are recomputed by the flight-time engine; the quote re-prices on save.</p>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', margin: '4px 2px 10px' }}>Legs</div>
          {legsForView.length ? <FlightsList legs={legsForView} hideColumns={HIDE} /> : (
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No legs found for this trip.</p>
          )}
        </>
      )}

      <div style={{ height: 16 }} />

      <Section title="Crew" right={
        crewEdit == null ? (
          <button onClick={startCrewEdit} disabled={busy}
            style={{ padding: '5px 12px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>✎ Assign crew</button>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={saveCrew} disabled={busy} style={{ padding: '5px 12px', fontSize: 12, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Save</button>
            <button onClick={() => setCrewEdit(null)} disabled={busy} style={{ padding: '5px 12px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>Cancel</button>
          </div>
        )
      }>
        {crewEdit != null ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[['pic', 'PIC', pilotRoster], ['sic', 'SIC', pilotRoster], ['fa', 'FA', cabinRoster]].map(([key, label, list]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', width: 34 }}>{label}</span>
                <select value={crewEdit[key]} onChange={(e) => setCrewEdit((d) => ({ ...d, [key]: e.target.value }))}
                  style={{ flex: 1, padding: '7px 10px', fontSize: 13, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8 }}>
                  <option value="">— Unassigned —</option>
                  {list.map((p) => <option key={crewKey(p)} value={crewKey(p)}>{p.name}{p.title ? ` · ${p.title}` : ''}</option>)}
                </select>
              </div>
            ))}
            <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Applies to all legs of this trip. {pilotRoster.length} pilots · {cabinRoster.length} cabin crew available.</p>
          </div>
        ) : crew.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {crew.map((c, i) => {
              const color = ROLE_COLOR[c.role] || '#888';
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: `${color}22`, color, border: `1px solid ${color}44` }}>{c.role}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{c.name}</span>
                  {c.title && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{c.title}</span>}
                </div>
              );
            })}
          </div>
        ) : <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No crew assigned.</p>}
      </Section>

      <Section title="Passengers" right={
        paxEdit == null ? (
          <button onClick={startPaxEdit} disabled={busy} style={{ padding: '5px 12px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>✎ Edit manifest</button>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={savePax} disabled={busy} style={{ padding: '5px 12px', fontSize: 12, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Save</button>
            <button onClick={() => setPaxEdit(null)} disabled={busy} style={{ padding: '5px 12px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>Cancel</button>
          </div>
        )
      }>
        {paxEdit != null ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <datalist id="pax-suggest">{paxSuggestions.map((p) => <option key={p.name} value={p.name} />)}</datalist>
            {paxEdit.map((p, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input list="pax-suggest" value={p.name} onChange={(e) => onPaxName(i, e.target.value)} placeholder="Passenger name" style={{ ...inp, flex: '2 1 160px' }} />
                <input type="number" min="0" value={p.weight_lbs} onChange={(e) => updatePax(i, 'weight_lbs', e.target.value)} placeholder="lbs" style={{ ...inp, flex: '0 1 70px' }} />
                <input type="date" value={p.dob || ''} onChange={(e) => updatePax(i, 'dob', e.target.value)} title="Date of birth" style={{ ...inp, flex: '1 1 130px' }} />
                <input value={p.note} onChange={(e) => updatePax(i, 'note', e.target.value)} placeholder="Note" style={{ ...inp, flex: '2 1 120px' }} />
                <button onClick={() => removePax(i)} title="Remove" style={{ padding: '7px 9px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>✕</button>
              </div>
            ))}
            <button onClick={addPax} style={{ alignSelf: 'flex-start', marginTop: 2, padding: '5px 12px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>+ Add passenger</button>
            <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Start typing a name to pick from previous passengers (fills DOB &amp; weight).</p>
          </div>
        ) : passengers.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {passengers.map((p) => {
              const pDocs = documents.filter((d) => d.passenger_id === p.id);
              return (
                <div key={p.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}</span>
                    {p.weight_lbs != null && <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{p.weight_lbs} lbs</span>}
                    {p.dob && <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>DOB {p.dob}</span>}
                    {p.note && <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>· {p.note}</span>}
                    <label style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--accent)', cursor: docBusy ? 'default' : 'pointer', opacity: docBusy ? 0.6 : 1 }}>
                      ↑ Upload ID/doc
                      <input type="file" disabled={docBusy} onChange={(e) => { uploadDoc(e.target.files?.[0], p.id); e.target.value = ''; }} style={{ display: 'none' }} />
                    </label>
                  </div>
                  {pDocs.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 5, paddingLeft: 2 }}>
                      {pDocs.map((d) => (
                        <span key={d.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 8px' }}>
                          {d.url ? <a href={d.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-primary)' }}>{d.name}</a> : <span style={{ color: 'var(--text-primary)' }}>{d.name}</span>}
                          <button onClick={() => deleteDoc(d.id)} disabled={docBusy} title="Delete" style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 12, padding: 0 }}>✕</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{pax > 0 ? `${pax} passenger${pax === 1 ? '' : 's'} on the legs — add names to the manifest.` : 'No passengers on the manifest.'}</p>}
      </Section>

      <Section title="Trip Checklist">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {['Contract', 'Payment received', 'Processed'].map((item) => (
            <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text-primary)' }}>
              <span style={{ width: 16, height: 16, borderRadius: 4, border: '1px solid var(--border)', display: 'inline-block', flexShrink: 0 }} />
              {item}
            </div>
          ))}
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 10 }}>Display-only — wired to the live trip checklist later.</p>
      </Section>

      <Section title="Documents">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <a href={`${API_BASE}/itinerary/${id}`} target="_blank" rel="noopener noreferrer"
            style={{ padding: '6px 12px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, textDecoration: 'none' }}>Passenger Itinerary ↗</a>
          <a href={`${API_BASE}/tripsheet/${id}`} target="_blank" rel="noopener noreferrer"
            style={{ padding: '6px 12px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, textDecoration: 'none' }}>Crew Trip Sheet ↗</a>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <select value={docType} onChange={(e) => setDocType(e.target.value)} style={{ ...inp }}>
              <option value="contract">Contract</option>
              <option value="quote">Signed quote</option>
              <option value="passenger_id">Passenger ID</option>
              <option value="handling">Handling</option>
              <option value="other">Other</option>
            </select>
            <label style={{ padding: '7px 14px', fontSize: 12, fontWeight: 600, background: 'var(--accent)', color: '#fff', borderRadius: 8, cursor: docBusy ? 'default' : 'pointer', opacity: docBusy ? 0.6 : 1 }}>
              {docBusy ? 'Uploading…' : '↑ Upload document'}
              <input type="file" disabled={docBusy} onChange={(e) => { uploadDoc(e.target.files?.[0]); e.target.value = ''; }} style={{ display: 'none' }} />
            </label>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Stored privately · max 25 MB</span>
          </div>
          {documents.filter((d) => !d.passenger_id).length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {documents.filter((d) => !d.passenger_id).map((d) => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--accent)', background: 'rgba(79,142,247,0.12)', border: '1px solid rgba(79,142,247,0.3)', borderRadius: 20, padding: '1px 8px', textTransform: 'capitalize' }}>{(d.doc_type || 'other').replace('_', ' ')}</span>
                  {d.url ? <a href={d.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{d.name}</a> : <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{d.name}</span>}
                  {d.size_bytes != null && <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{Math.max(1, Math.round(d.size_bytes / 1024))} KB</span>}
                  <button onClick={() => deleteDoc(d.id)} disabled={docBusy} title="Delete" style={{ marginLeft: 'auto', padding: '3px 9px', fontSize: 11, background: 'var(--bg-secondary)', color: 'var(--danger)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}>Delete</button>
                </div>
              ))}
            </div>
          ) : <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No trip documents yet.</p>}
        </div>
      </Section>

      <Section title="History">
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Source: {meta?.origin === 'native' ? 'Created here' : 'LevelFlight (mirrored)'}
          {meta?.locally_modified ? ' · Edited locally' : ''}
          {meta?.upstream_changed ? ' · LevelFlight changed upstream' : ''}
        </p>
      </Section>
    </div>
  );
}
