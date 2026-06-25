import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch, API_BASE } from '../lib/api';
import { useApi } from '../hooks/useApi';
import { distinctClients } from '../lib/schedulingAggregate';
import AirportInput from '../components/AirportInput';
import FboPicker from '../components/trip/FboPicker';
import { easternToUTC, zuluParts, easternInputParts } from '../lib/easternTime';
import { recomputeInputs } from '../lib/feesMath';
import PricingSummary from '../components/pricing/PricingSummary';
import PricingSlideOut from '../components/pricing/PricingSlideOut';

const FLEET = ['N408JS', 'N69FP'];
const blankLeg = () => ({ _id: crypto.randomUUID(), dep_icao: '', arr_icao: '', dep_date: '', dep_clock: '', pax: '', positioning: false, dep_fbo: null, arr_fbo: null });
const legDepUTC = (l) => easternToUTC(l.dep_date, l.dep_clock);
const legDepIso = (l) => { const d = legDepUTC(l); return d ? d.toISOString() : ''; };
const toMs = (t) => (t == null ? null : (typeof t === 'number' ? t : Date.parse(t)));

const labelStyle = { fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 };
const inputStyle = { width: '100%', padding: '8px 10px', fontSize: 13, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, boxSizing: 'border-box' };
const captionStyle = { fontSize: 10, marginTop: 3, minHeight: 13, whiteSpace: 'nowrap', color: 'var(--text-secondary)' };

// Live distance + flight time for a leg (debounced) — the working estimate engine.
function useLegEstimate(dep, arr, depIso) {
  const [est, setEst] = useState(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const a = (dep || '').trim(), b = (arr || '').trim();
    if (a.length < 3 || b.length < 3) { setEst(null); return; }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const q = new URLSearchParams({ from: a, to: b });
        if (depIso) q.set('dep', depIso);
        const r = await apiFetch(`/api/scheduling/leg-estimate?${q.toString()}`);
        setEst(await r.json());
      } catch { setEst(null); }
      setLoading(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [dep, arr, depIso]);
  return { est, loading };
}

function LegSummary({ est, loading }) {
  if (loading) return <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>calculating…</span>;
  if (!est) return null;
  if (est.distanceNm == null) return <span style={{ fontSize: 11, color: '#f59e0b' }}>airport not found — check the codes</span>;
  const h = Math.floor(est.minutes / 60), m = est.minutes % 60;
  return (
    <span style={{ fontSize: 11, color: 'var(--accent)' }}>
      ≈ {est.distanceNm.toLocaleString()} nm · {h}:{String(m).padStart(2, '0')} ETE{est.source === 'history' ? ' (from history)' : ''}
    </span>
  );
}

function LegRow({ leg, i, total, onUpdate, onRemove }) {
  const depUTC = legDepUTC(leg);
  const { est, loading } = useLegEstimate(leg.dep_icao, leg.arr_icao, depUTC ? depUTC.toISOString() : '');
  const z = zuluParts(depUTC);
  const etaZ = zuluParts(est?.arrTime ? new Date(est.arrTime) : null);
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 10, flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 130px' }}><label style={labelStyle}>From</label><AirportInput value={leg.dep_icao} onChange={(v) => onUpdate(i, 'dep_icao', v)} placeholder="code or city" inputStyle={inputStyle} /></div>
      <div style={{ flex: '1 1 130px' }}>
        <label style={labelStyle}>To</label>
        <AirportInput value={leg.arr_icao} onChange={(v) => onUpdate(i, 'arr_icao', v)} placeholder="code or city" inputStyle={inputStyle} />
        <div style={{ ...captionStyle, color: 'var(--accent)' }}>{etaZ ? `ETA ${etaZ.date} · ${etaZ.time}Z` : ''}</div>
      </div>
      <div style={{ flex: '1 1 120px' }}>
        <label style={labelStyle}>Date</label>
        <input type="date" value={leg.dep_date} onChange={(e) => onUpdate(i, 'dep_date', e.target.value)} style={inputStyle} />
        <div style={captionStyle}>{z ? `${z.date} Z` : ''}</div>
      </div>
      <div style={{ flex: '0 1 100px' }}>
        <label style={labelStyle}>ETD local</label>
        <input type="time" value={leg.dep_clock} onChange={(e) => onUpdate(i, 'dep_clock', e.target.value)} style={inputStyle} />
        <div style={captionStyle}>{z ? `${z.time}Z` : ''}</div>
      </div>
      <div style={{ flex: '0 1 70px' }}><label style={labelStyle}>Pax</label><input type="number" min="0" value={leg.pax} onChange={(e) => onUpdate(i, 'pax', e.target.value)} placeholder="0" style={inputStyle} /></div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)', marginTop: 22 }}><input type="checkbox" checked={leg.positioning} onChange={(e) => onUpdate(i, 'positioning', e.target.checked)} /> Ferry</label>
      <button onClick={() => onRemove(i)} disabled={total === 1} title="Remove leg"
        style={{ marginTop: 20, padding: '8px 10px', fontSize: 13, background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 8, cursor: total === 1 ? 'default' : 'pointer' }}>✕</button>
      <div style={{ flexBasis: '100%', display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
        <FboPicker label="Dep FBO" icao={leg.dep_icao} value={leg.dep_fbo} onChange={(fbo) => onUpdate(i, 'dep_fbo', fbo)} />
        <FboPicker label="Arr FBO" icao={leg.arr_icao} value={leg.arr_fbo} onChange={(fbo) => onUpdate(i, 'arr_fbo', fbo)} />
      </div>
      <div style={{ flexBasis: '100%', minHeight: 14 }}><LegSummary est={est} loading={loading} /></div>
    </div>
  );
}

// Convert a mirror leg (LF-shaped snapshot) into the editor's leg form.
function legToForm(l) {
  const p = easternInputParts(toMs(l.departure?.time));
  return {
    _id: crypto.randomUUID(),
    dep_icao: l.departure?.airport || '', arr_icao: l.arrival?.airport || '',
    dep_date: p.date, dep_clock: p.clock,
    pax: l.passengerCount ?? '', positioning: !!l.isPositioning,
    dep_fbo: l.departure?.fbo || null, arr_fbo: l.arrival?.fbo || null,
  };
}

export default function QuoteEditor() {
  const { quoteNo } = useParams();
  const navigate = useNavigate();
  const [trip, setTrip] = useState(null);
  const [legs, setLegs] = useState([]);
  const [tail, setTail] = useState(FLEET[0]);
  const [purpose, setPurpose] = useState('charter');
  const [company, setCompany] = useState('');
  const [contact, setContact] = useState({ name: '', email: '', phone: '' });
  const [pricing, setPricing] = useState(null);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [pricingCollapsed, setPricingCollapsed] = useState(false);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const loaded = useRef(false);

  const { data: legsData } = useApi('/api/scheduling/legs');
  const clients = distinctClients(legsData?.legs || []);
  const { data: rateCards } = useApi('/api/rate-cards');
  const fleet = [...new Set((Array.isArray(rateCards) ? rateCards : []).map((c) => c.aircraft_tail).filter(Boolean))];
  const FLEET_OPTIONS = fleet.length ? fleet : FLEET;

  const tripId = trip?.id || null;
  const readOnly = trip && trip.status !== 'quote';

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/scheduling/quotes/${quoteNo}`);
      const j = await r.json();
      if (!r.ok || !j.trip) { setError(j.error || 'Quote not found'); return; }
      loaded.current = false;
      setTrip(j.trip);
      setTail(j.legs?.[0]?.dispatch?.aircraft?.tailNumber || FLEET[0]);
      setPurpose(j.trip.purpose || 'charter');
      setCompany(j.trip.company_name || '');
      setContact(j.trip.contact && typeof j.trip.contact === 'object' ? { name: j.trip.contact.name || '', email: j.trip.contact.email || '', phone: j.trip.contact.phone || '' } : { name: '', email: '', phone: '' });
      const p = j.trip.pricing && !j.trip.pricing.error ? j.trip.pricing : null;
      // Merge fees + fetEnabled defaults into pricing so the shared components have
      // a single authoritative source. Fresh quotes may not have these fields yet.
      const defaultFetEnabled = (j.trip.purpose || 'charter') !== 'owner';
      setPricing(p ? {
        ...p,
        fees: Array.isArray(p.fees) ? p.fees.map((f) => ({ ...f })) : [],
        fetEnabled: p.fetEnabled !== undefined ? p.fetEnabled !== false : defaultFetEnabled,
      } : null);
      setLegs((j.legs || []).map(legToForm));
      if (!j.legs?.length) setLegs([blankLeg()]);
    } catch (e) { setError(e.message); }
  }, [quoteNo]);
  useEffect(() => { load(); }, [load]);

  const updateLeg = (i, field, value) => setLegs((ls) => ls.map((l, idx) => {
    if (idx === i) return { ...l, [field]: value };
    if (field === 'arr_icao' && idx === i + 1 && !l.dep_icao) return { ...l, dep_icao: value };
    return l;
  }));
  const addLeg = () => setLegs((ls) => [...ls, { ...blankLeg(), dep_icao: ls[ls.length - 1]?.arr_icao || '' }]);
  const removeLeg = (i) => setLegs((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls));

  const cleanedLegs = legs
    .filter((l) => (l.dep_icao || '').trim() && (l.arr_icao || '').trim())
    .map((l) => ({ dep_icao: l.dep_icao.trim(), arr_icao: l.arr_icao.trim(), dep_time: legDepIso(l), pax: l.pax, positioning: l.positioning, dep_fbo: l.dep_fbo || null, arr_fbo: l.arr_fbo || null }));

  // Autosave the quote header + legs (debounced) — reprices, preserving fees/override.
  const detailsKey = JSON.stringify({ tail, purpose, company, contact, legs: cleanedLegs });
  useEffect(() => {
    if (!loaded.current || !tripId || readOnly || !cleanedLegs.length) return;
    const t = setTimeout(async () => {
      setSaveState('saving'); setError(null);
      try {
        const r = await apiFetch(`/api/scheduling/trips/${tripId}/details`, {
          method: 'PATCH',
          body: JSON.stringify({ aircraft_tail: tail, customer_name: company, company_name: company, contact, purpose, legs: cleanedLegs }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || `Save failed (${r.status})`);
        if (j.pricing) setPricing(j.pricing && !j.pricing.error ? j.pricing : null);
        setSaveState('saved');
      } catch (e) { setError(e.message); setSaveState('error'); }
    }, 700);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailsKey]);

  // Autosave pricing controls (debounced) — broadened to include all editable fields
  // from the slide-out: overrides, rates, counts, ad-hoc fees, FET, total override.
  const priceKey = JSON.stringify({
    overrides: pricing?.overrides,
    costPerHr: pricing?.costPerHr,
    posRate: pricing?.posRate,
    surchargePerHr: pricing?.surchargePerHr,
    landingFee: pricing?.landingFee,
    landings: pricing?.landings,
    nights: pricing?.nights,
    faCount: pricing?.faCount,
    crewCount: pricing?.crewCount,
    segmentPerPax: pricing?.segmentPerPax,
    fees: pricing?.fees,
    fetEnabled: pricing?.fetEnabled,
    totalOverride: pricing?.totalOverride,
  });
  useEffect(() => {
    if (!loaded.current || !tripId || readOnly || !pricing) return;
    const t = setTimeout(async () => {
      setSaveState('saving'); setError(null);
      try {
        const r = await apiFetch(`/api/scheduling/trips/${tripId}/price-lines`, {
          method: 'PATCH',
          body: JSON.stringify({
            overrides: pricing.overrides,
            costPerHr: pricing.costPerHr,
            posRate: pricing.posRate,
            surchargePerHr: pricing.surchargePerHr,
            landingFee: pricing.landingFee,
            landings: pricing.landings,
            nights: pricing.nights,
            faCount: pricing.faCount,
            crewCount: pricing.crewCount,
            segmentPerPax: pricing.segmentPerPax,
            fees: pricing.fees,
            fetEnabled: pricing.fetEnabled,
            totalOverride: pricing.totalOverride,
          }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || `Save failed (${r.status})`);
        // Server is authoritative — replace local pricing with the recomputed result.
        if (j.pricing) setPricing(j.pricing && !j.pricing.error ? j.pricing : null);
        setSaveState('saved');
      } catch (e) { setError(e.message); setSaveState('error'); }
    }, 700);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceKey]);

  // Mark loaded only after the post-load render's autosave effects have run (and
  // skipped because loaded.current was still false), so loading never triggers a save.
  useEffect(() => { if (trip) loaded.current = true; }, [trip?.id]);

  // Merge a pricing patch into local pricing, recompute live, and let the autosave persist it.
  const patchPricing = (patch) => {
    setPricing((p) => {
      const merged = { ...(p || {}), ...patch };
      if (patch.overrides) merged.overrides = patch.overrides;
      return { ...merged, ...recomputeInputs(merged) };
    });
  };

  const recalcPricing = async () => {
    try {
      const r = await apiFetch(`/api/scheduling/trips/${tripId}/price`, { method: 'POST', body: JSON.stringify({}) });
      const j = await r.json();
      if (r.ok && j.pricing) setPricing(j.pricing && !j.pricing.error ? j.pricing : null);
    } catch (e) { setError(e.message); }
  };

  const book = async () => {
    setBusy(true); setError(null);
    try {
      const r = await apiFetch(`/api/scheduling/trips/${tripId}`, { method: 'PATCH', body: JSON.stringify({ status: 'booked' }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Book failed (${r.status})`);
      navigate(`/scheduling/trips/${j.trip.trip_number || tripId}`);
    } catch (e) { setError(e.message); setBusy(false); }
  };
  const discard = async () => {
    if (!window.confirm('Discard this quote permanently? This cannot be undone.')) return;
    setBusy(true); setError(null);
    try {
      const r = await apiFetch(`/api/scheduling/trips/${tripId}`, { method: 'DELETE' });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `Delete failed (${r.status})`); }
      navigate('/scheduling');
    } catch (e) { setError(e.message); setBusy(false); }
  };

  const saveLabel = { idle: '', saving: 'Saving…', saved: 'Saved ✓', error: 'Save failed' }[saveState];
  const saveColor = saveState === 'error' ? 'var(--danger)' : 'var(--text-secondary)';

  if (!trip && !error) return <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Loading quote…</p>;

  const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 16 };
  const sendBtns = (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <a href={`${API_BASE}/quote/${tripId}`} target="_blank" rel="noopener noreferrer"
        style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'var(--accent)', color: '#fff', borderRadius: 8, textDecoration: 'none' }}>View Quote ↗</a>
      <a href={`${API_BASE}/quote/${tripId}/pdf`} target="_blank" rel="noopener noreferrer"
        style={{ padding: '8px 14px', fontSize: 13, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, textDecoration: 'none' }}>Quote PDF ↗</a>
      <button onClick={() => navigator.clipboard?.writeText(`${API_BASE}/quote/${tripId}`)}
        style={{ padding: '8px 14px', fontSize: 13, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>Copy client link</button>
    </div>
  );

  return (
    <div style={{ maxWidth: 920 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/scheduling')}
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13 }}>← Scheduling</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: 'var(--text-primary)' }}>Quote {trip?.quote_number || quoteNo}</h1>
          {readOnly && trip?.trip_number && (
            <button onClick={() => navigate(`/scheduling/trips/${trip.trip_number}`)}
              style={{ marginTop: 4, fontSize: 13, color: 'var(--accent)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>Booked as Trip {trip.trip_number} →</button>
          )}
        </div>
        {!readOnly && <span style={{ fontSize: 12, color: saveColor, minWidth: 70, textAlign: 'right' }}>{saveLabel}</span>}
      </div>

      {error && <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '12px 16px', color: 'var(--danger)', marginBottom: 16 }}>{error}</div>}

      {readOnly ? (
        <div style={card}>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>This quote has been booked. Editing happens on the trip page; the quote stays available to send.</p>
          {sendBtns}
        </div>
      ) : (<>
        <div style={{ ...card, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 150px' }}>
            <label style={labelStyle}>Aircraft</label>
            <select value={tail} onChange={(e) => setTail(e.target.value)} style={inputStyle}>
              {FLEET_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={{ flex: '1 1 140px' }}>
            <label style={labelStyle}>Purpose</label>
            <select value={purpose} onChange={(e) => setPurpose(e.target.value)} style={inputStyle}>
              <option value="charter">Charter</option>
              <option value="owner">Owner</option>
            </select>
          </div>
          <div style={{ flex: '2 1 220px' }}>
            <label style={labelStyle}>Company</label>
            <input list="qe-clients" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company or client" style={inputStyle} />
            <datalist id="qe-clients">{clients.map((c) => <option key={c.name} value={c.name} />)}</datalist>
          </div>
          <div style={{ flex: '1 1 100%', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 180px' }}><label style={labelStyle}>Contact name</label><input value={contact.name} onChange={(e) => setContact((c) => ({ ...c, name: e.target.value }))} placeholder="Jane Smith" style={inputStyle} /></div>
            <div style={{ flex: '1 1 180px' }}><label style={labelStyle}>Contact email</label><input value={contact.email} onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))} placeholder="jane@company.com" style={inputStyle} /></div>
            <div style={{ flex: '1 1 140px' }}><label style={labelStyle}>Contact phone</label><input value={contact.phone} onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))} placeholder="(305) 555-0100" style={inputStyle} /></div>
          </div>
        </div>

        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>Legs</div>
          {legs.map((l, i) => (
            <LegRow key={l._id} leg={l} i={i} total={legs.length} onUpdate={updateLeg} onRemove={removeLeg} />
          ))}
          <button onClick={addLeg}
            style={{ marginTop: 4, padding: '6px 14px', fontSize: 13, background: 'var(--bg-secondary)', color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>+ Add leg</button>
          <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 10 }}>ETD is local Eastern (Zulu shown beneath); the ETA under each arrival comes from the flight-time engine.</p>
        </div>

        <PricingSummary
          pricing={pricing}
          collapsed={pricingCollapsed}
          onToggle={() => setPricingCollapsed((c) => !c)}
          onOpen={() => setPricingOpen(true)}
          editable={!readOnly}
        />
        {pricingOpen && !readOnly && (
          <PricingSlideOut
            pricing={pricing}
            onPatch={patchPricing}
            onRecalculate={recalcPricing}
            onClose={() => setPricingOpen(false)}
          />
        )}

        <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {sendBtns}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={discard} disabled={busy} title="Discard this quote"
              style={{ padding: '9px 16px', fontSize: 13, background: 'rgba(239,68,68,0.1)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, cursor: 'pointer' }}>Discard</button>
            <button onClick={book} disabled={busy}
              style={{ padding: '9px 20px', fontSize: 14, fontWeight: 600, background: '#a855f7', color: '#fff', border: 'none', borderRadius: 8, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
              {busy ? 'Booking…' : 'Book trip'}
            </button>
          </div>
        </div>
      </>)}
    </div>
  );
}
