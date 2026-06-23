import { useEffect, useState, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { apiFetch, API_BASE } from '../lib/api';
import FlightsList from '../components/FlightsList';
import ItinerarySendModal from '../components/ItinerarySendModal';
import { distinctCrew, distinctClients } from '../lib/schedulingAggregate';
import { useApi } from '../hooks/useApi';
import TripTabs from '../components/trip/TripTabs';
import TripInfoCard from '../components/trip/TripInfoCard';
import TripActionsRail from '../components/trip/TripActionsRail';
import FboPicker from '../components/trip/FboPicker';
import { recomputeInputs } from '../lib/feesMath';
import { FEE_CODES } from '../lib/feeCatalog';


const FLEET = ['N408JS', 'N69FP'];
const blankLeg = () => ({ dep_icao: '', arr_icao: '', dep_time: '', pax: '', positioning: false });
const toLocalInput = (ms) => { if (!ms) return ''; const d = new Date(ms); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const inp = { padding: '7px 10px', fontSize: 13, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, boxSizing: 'border-box' };

// Action buttons come from the backend (the valid next actions for the trip's
// current stage: Quote→Book→Release, with Cancel until closed). "Release" also makes
// the Crew Trip Sheet available; a released trip auto-closes once the flight is done.
const ACTION_COLOR = { book: '#a855f7', release: '#3b82f6', cancel: '#ef4444' };
const usd = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString());

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
  const [showSend, setShowSend] = useState(false);      // itinerary send modal
  const [docType, setDocType] = useState('contract');
  const [docBusy, setDocBusy] = useState(false);
  const [tab, setTab] = useState('legs');
  const TABS = [
    { id: 'legs', label: 'Legs' },
    { id: 'fees', label: 'Fees' },
    { id: 'crew', label: 'Crew' },
    { id: 'pax', label: 'Passengers' },
    { id: 'docs', label: 'Documents' },
  ];

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

  const deleteTrip = async () => {
    if (!window.confirm('Permanently delete this trip and all its legs, passengers, and documents? This cannot be undone.')) return;
    setBusy(true); setError(null);
    try {
      const r = await apiFetch(`/api/scheduling/trips/${id}`, { method: 'DELETE' });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `Delete failed (${r.status})`); }
      navigate('/scheduling'); // it's gone — back to the list
      return;
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
      fees: Array.isArray(p.fees) ? p.fees.map((f) => ({ ...f })) : [],
      fetEnabled: p.fetEnabled !== false,
      totalOverride: p.totalOverride ?? null,
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

  const updateFee = (idx, field, value) =>
    setPriceEdit((d) => ({ ...d, fees: d.fees.map((f, i) => (i === idx ? { ...f, [field]: value } : f)) }));
  const addFee = () =>
    setPriceEdit((d) => ({ ...d, fees: [...(d.fees || []), { code: FEE_CODES[0], description: '', amount: 0, taxable: true }] }));
  const removeFee = (idx) =>
    setPriceEdit((d) => ({ ...d, fees: d.fees.filter((_, i) => i !== idx) }));

  // Legs: prefer the mirror response; fall back to router state during the first paint.
  const legsForView = legs.length ? legs : (stateTrip?.legs || []);
  const tail = stateTrip?.tail || legsForView[0]?.dispatch?.aircraft?.tailNumber || null;
  const client = stateTrip?.client || legsForView[0]?.dispatch?.client?.company?.name || null;
  const airports = legsForView.length
    ? legsForView.flatMap((l, i) => (i === 0 ? [l.departure?.airport, l.arrival?.airport] : [l.arrival?.airport])).filter(Boolean)
    : [];
  const routeSummary = stateTrip?.routeSummary || (airports.length ? airports.join(' → ') : null);
  const title = routeSummary || (meta?.trip_number ? `Trip #${meta.trip_number}` : 'Trip');
  const subtitle = [
    meta?.trip_number ? `Trip #${meta.trip_number}` : null,
    meta?.quote_number ? `Quote ${meta.quote_number}` : null,
    tail, client,
  ].filter(Boolean).join(' · ');
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
  // Passenger manifest editor — people-directory-based picker.
  const [peopleQuery, setPeopleQuery] = useState('');
  const [peopleResults, setPeopleResults] = useState([]);
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      try {
        const r = await apiFetch(`/api/scheduling/people?q=${encodeURIComponent(peopleQuery)}`);
        const j = await r.json();
        if (live) setPeopleResults(j.people || []);
      } catch { /* ignore */ }
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [peopleQuery]);

  // Draft rows carry person_id + per-trip fields; identity (name/dob/weight) is
  // carried for display only — it comes from the joined person on the backend.
  const startPaxEdit = () => setPaxEdit((passengers || []).map((p) => ({
    id: p.id, person_id: p.person_id, name: p.name, dob: p.dob, weight_lbs: p.weight_lbs,
    seat: p.seat || '', cargo_lbs: p.cargo_lbs ?? '', tsa_status: p.tsa_status || '', note: p.note || '',
  })));

  const updatePax = (i, field, v) => setPaxEdit((d) => d.map((p, idx) => (idx === i ? { ...p, [field]: v } : p)));
  const removePax = (i) => setPaxEdit((d) => d.filter((_, idx) => idx !== i));

  const addPerson = (person) => {
    setPaxEdit((d) => {
      if ((d || []).some((r) => r.person_id === person.id)) return d; // already on the trip
      return [...(d || []), {
        person_id: person.id, name: [person.first_name, person.middle_name, person.last_name].filter(Boolean).join(' '),
        dob: person.dob, weight_lbs: person.weight_lbs, seat: '', cargo_lbs: '', tsa_status: '', note: '',
      }];
    });
    setPeopleQuery('');
  };

  const addNewPerson = async () => {
    const first = window.prompt('First name?'); if (!first) return;
    const last = window.prompt('Last name?') || '';
    try {
      const r = await apiFetch('/api/scheduling/people', { method: 'POST', body: JSON.stringify({ first_name: first, last_name: last }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Create failed');
      addPerson(j.person);
    } catch (e) { setError(e.message); }
  };

  const savePax = async () => {
    setBusy(true); setError(null);
    try {
      const r = await apiFetch(`/api/scheduling/trips/${id}/passengers`, { method: 'PUT', body: JSON.stringify({ passengers: paxEdit }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Save failed (${r.status})`);
      setPassengers(j.passengers || []);
      setPaxEdit(null);
      setPeopleQuery('');
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
      dep_fbo: l.departure?.fbo || null, arr_fbo: l.arrival?.fbo || null,
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

  const CHECKLIST_ITEMS = [
    { key: 'contractReceived', label: 'Contract received' },
    { key: 'paymentReceived', label: 'Payment received' },
    { key: 'paymentProcessed', label: 'Payment processed' },
  ];
  const toggleChecklist = async (key) => {
    const cur = meta?.checklist || {};
    const next = { ...cur, [key]: !cur[key] };
    setMeta((m) => ({ ...m, checklist: next })); // optimistic
    setError(null);
    try {
      const r = await apiFetch(`/api/scheduling/trips/${id}/checklist`, { method: 'PATCH', body: JSON.stringify({ [key]: next[key] }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `Save failed (${r.status})`); }
      const j = await r.json();
      setMeta((m) => ({ ...m, checklist: j.checklist }));
    } catch (e) { setError(e.message); await load(); }
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
        {isNative && detailsEdit == null && (
          <button onClick={deleteTrip} disabled={busy} title="Delete this trip (created here)"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '8px 14px', color: 'var(--danger)', cursor: 'pointer', fontSize: 13 }}>🗑 Delete</button>
        )}
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '12px 16px', color: 'var(--danger)', marginBottom: 16 }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <TripInfoCard trip={meta} tail={tail} aircraftType={legsForView[0]?.dispatch?.aircraft?.type?.name || null} client={client} />
        <TripActionsRail
          meta={meta} id={id} busy={busy}
          onAction={setStatus} onRevert={revert} onSendItinerary={() => setShowSend(true)} released={released}
        />
      </div>
      {meta?.stage === 'closed' && <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 12px' }}>This trip is closed.</p>}
      {meta?.stage === 'cancelled' && <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 12px' }}>This trip is cancelled.</p>}
      {showSend && <ItinerarySendModal dispatchId={id} onClose={() => setShowSend(false)} />}
      <TripTabs tabs={TABS} active={tab} onSelect={setTab} />

      {tab === 'legs' && (<>
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
                <FboPicker label="Dep FBO" icao={l.dep_icao} value={l.dep_fbo} onChange={(fbo) => updateEditLeg(i, 'dep_fbo', fbo)} />
                <FboPicker label="Arr FBO" icao={l.arr_icao} value={l.arr_fbo} onChange={(fbo) => updateEditLeg(i, 'arr_fbo', fbo)} />
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
      </>)}

      {tab === 'fees' && (<>
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
                      <tr><td colSpan={2} style={{ paddingTop: 10, fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '.04em' }}>AD-HOC FEES</td></tr>
                      {(priceEdit.fees || []).map((f, i) => (
                        <tr key={i}>
                          <td style={{ padding: '3px 0' }}>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                              <select value={f.code || ''} onChange={(e) => updateFee(i, 'code', e.target.value)}
                                style={{ ...inp, padding: '4px 6px', fontSize: 12 }}>
                                {FEE_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
                              </select>
                              <input value={f.description || ''} onChange={(e) => updateFee(i, 'description', e.target.value)} placeholder="Description"
                                style={{ ...inp, padding: '4px 6px', fontSize: 12, flex: '1 1 120px' }} />
                              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-secondary)' }}>
                                <input type="checkbox" checked={!!f.taxable} onChange={(e) => updateFee(i, 'taxable', e.target.checked)} /> Taxable
                              </label>
                              <button onClick={() => removeFee(i)} style={{ padding: '2px 7px', fontSize: 11, background: 'var(--bg-secondary)', color: 'var(--danger)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}>✕</button>
                            </div>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <input type="number" value={f.amount} onChange={(e) => updateFee(i, 'amount', e.target.value)}
                              style={{ width: 78, textAlign: 'right', padding: '2px 5px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 5 }} />
                          </td>
                        </tr>
                      ))}
                      <tr><td colSpan={2} style={{ padding: '4px 0' }}>
                        <button onClick={addFee} style={{ padding: '4px 12px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>+ New Fee</button>
                      </td></tr>
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
                      {Array.isArray(p.fees) && p.fees.length > 0 && p.fees.map((f, i) => (
                        <tr key={`vf${i}`}><td>{f.code}{f.description ? ` · ${f.description}` : ''}{f.taxable ? '' : ' (non-tax)'}</td><td style={{ textAlign: 'right' }}>{usd(Number(f.amount) || 0)}</td></tr>
                      ))}
                    </>
                  )}
                  <tr>
                    <td>{editing ? (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input type="checkbox" checked={priceEdit.fetEnabled !== false}
                          onChange={(e) => setPriceEdit((d) => ({ ...d, fetEnabled: e.target.checked }))} />
                        FET ({Math.round(fetRate * 1000) / 10}%)
                      </label>
                    ) : `FET (${Math.round(fetRate * 1000) / 10}%)`}</td>
                    <td style={{ textAlign: 'right' }}>{usd(live.fetAmount)}</td>
                  </tr>
                  <tr>
                    <td style={{ paddingTop: 6, fontWeight: 700, color: 'var(--text-primary)' }}>Total{!editing && p.totalOverride != null ? ' · adjusted' : ''}</td>
                    <td style={{ paddingTop: 6, textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {editing ? (
                        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
                          <input type="number" value={priceEdit.totalOverride ?? ''} placeholder={String(live.computedTotal)}
                            onChange={(e) => setPriceEdit((d) => ({ ...d, totalOverride: e.target.value === '' ? null : e.target.value }))}
                            style={{ width: 96, textAlign: 'right', padding: '2px 5px', fontSize: 13, fontWeight: 700, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 5 }} />
                          {priceEdit.totalOverride != null && priceEdit.totalOverride !== '' &&
                            <button title="Clear override" onClick={() => setPriceEdit((d) => ({ ...d, totalOverride: null }))}
                              style={{ padding: '2px 7px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}>↺</button>}
                        </span>
                      ) : usd(live.total)}
                    </td>
                  </tr>
                </tbody>
              </table>
              {editing && <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 8 }}>Adjust any charge — FET and total update automatically. "Re-price" reverts to the rate-card calculation.</p>}
            </div>
          );
        })())}
      </>)}

      {tab === 'crew' && (
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
      )}

      {tab === 'pax' && (
        <Section title="Passengers" right={
          !paxEdit && (
            <button onClick={startPaxEdit} disabled={busy} style={{ padding: '5px 12px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>✎ Edit manifest</button>
          )
        }>
          {paxEdit ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* picker */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input value={peopleQuery} onChange={(e) => setPeopleQuery(e.target.value)} placeholder="Search people to add…" style={{ ...inp, flex: '1 1 220px' }} />
                <button onClick={addNewPerson} style={{ padding: '5px 12px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>+ Add new person</button>
              </div>
              {peopleQuery && peopleResults.length > 0 && (
                <div style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
                  {peopleResults.map((r) => (
                    <div key={r.id} onClick={() => addPerson(r)} style={{ padding: '7px 10px', fontSize: 13, cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}>
                      <span>{[r.first_name, r.middle_name, r.last_name].filter(Boolean).join(' ')} <span style={{ color: 'var(--text-secondary)' }}>· {r.dob || 'no DOB'}{r.hasPassport ? ' · 🛂' : ''}</span></span>
                      <span style={{ color: 'var(--accent)' }}>add →</span>
                    </div>
                  ))}
                </div>
              )}
              {/* manifest rows: identity read-only, per-trip editable */}
              {(paxEdit || []).map((p, i) => (
                <div key={p.person_id} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
                  <span style={{ flex: '2 1 160px', fontSize: 13, color: 'var(--text-primary)' }}>{p.name} <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{p.dob || ''}</span></span>
                  <input value={p.seat} onChange={(e) => updatePax(i, 'seat', e.target.value)} placeholder="Seat" style={{ ...inp, flex: '0 1 70px' }} />
                  <input value={p.cargo_lbs} onChange={(e) => updatePax(i, 'cargo_lbs', e.target.value)} placeholder="Bags lb" type="number" style={{ ...inp, flex: '0 1 80px' }} />
                  <input value={p.tsa_status} onChange={(e) => updatePax(i, 'tsa_status', e.target.value)} placeholder="TSA" style={{ ...inp, flex: '0 1 90px' }} />
                  <input value={p.note} onChange={(e) => updatePax(i, 'note', e.target.value)} placeholder="Trip note" style={{ ...inp, flex: '1 1 120px' }} />
                  <button onClick={() => removePax(i)} style={{ padding: '4px 8px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--danger)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>✕</button>
                </div>
              ))}
              {error && <p style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</p>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={savePax} disabled={busy} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>{busy ? 'Saving…' : 'Save manifest'}</button>
                <button onClick={() => { setPaxEdit(null); setPeopleQuery(''); }} style={{ padding: '6px 14px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>Cancel</button>
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Name, DOB &amp; weight come from the person — edit those on their profile. Only seat/bags/TSA/note are per-trip.</p>
            </div>
          ) : passengers.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {passengers.map((p) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, flexWrap: 'wrap' }}>
                  <a href={`/scheduling/people/${p.person_id}`} style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>{p.name}</a>
                  {p.hasPassport && <span title="Passport on file">🛂</span>}
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {p.dob ? `DOB ${p.dob}` : ''}{p.weight_lbs ? ` · ${p.weight_lbs} lb` : ''}{p.seat ? ` · seat ${p.seat}` : ''}{p.cargo_lbs ? ` · ${p.cargo_lbs} lb bags` : ''}{p.tsa_status ? ` · ${p.tsa_status}` : ''}{p.note ? ` · ${p.note}` : ''}
                  </span>
                </div>
              ))}
            </div>
          ) : <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No passengers on the manifest. Click "Edit manifest" to add some.</p>}
        </Section>
      )}

      {tab === 'docs' && (<>
        <Section title="Trip Checklist">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {CHECKLIST_ITEMS.map((it) => (
              <label key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!(meta?.checklist || {})[it.key]} onChange={() => toggleChecklist(it.key)} />
                {it.label}
              </label>
            ))}
          </div>
        </Section>

        <Section title="Documents">
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
      </>)}
    </div>
  );
}
