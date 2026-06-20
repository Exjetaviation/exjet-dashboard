import { useEffect, useState, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { apiFetch, API_BASE } from '../lib/api';
import FlightsList from '../components/FlightsList';
import TripSheetActions from '../components/TripSheetActions';
import { distinctCrew } from '../lib/schedulingAggregate';

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

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/scheduling/trips/${id}`);
      const j = await r.json();
      if (j.trip) { setMeta(j.trip); setLegs(j.legs || []); }
      else setError(j.error || 'Trip not found');
    } catch (e) { setError(e.message); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

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

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/scheduling')}
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13 }}>← Scheduling</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{subtitle}</p>
        </div>
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
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Crew Trip Sheet:</span>
                <TripSheetActions dispatchId={id} tripId={meta?.trip_number} compact />
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

      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', margin: '4px 2px 10px' }}>Legs</div>
      {legsForView.length ? <FlightsList legs={legsForView} hideColumns={HIDE} /> : (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No legs found for this trip.</p>
      )}

      <div style={{ height: 16 }} />

      <Section title="Crew">
        {crew.length ? (
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

      <Section title="Passengers">
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{pax > 0 ? `${pax} passenger${pax === 1 ? '' : 's'} (max across legs)` : 'No passengers on the manifest.'}</p>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <a href={`${API_BASE}/itinerary/${id}`} target="_blank" rel="noopener noreferrer"
            style={{ padding: '6px 12px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, textDecoration: 'none' }}>Passenger Itinerary ↗</a>
          <TripSheetActions dispatchId={id} tripId={meta?.trip_number} compact />
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
