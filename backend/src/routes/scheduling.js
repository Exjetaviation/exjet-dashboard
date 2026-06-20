// backend/src/routes/scheduling.js
import express from 'express';
import { supabase } from '../services/supabase.js';
import { formatSyncStatus } from '../scheduling/formatSyncStatus.js';
import { mirrorLegsFromRows } from '../scheduling/mirrorLegs.js';
import { statusLabel, isSettableStatus } from '../scheduling/dispatchStatus.js';
import { tripColumnsFromSnapshot } from '../scheduling/tripFromSnapshot.js';
import { canEditScheduling } from '../scheduling/canEdit.js';
import { buildNativeLegSnapshot } from '../scheduling/buildNativeLeg.js';
import { workflowStage, nextActions, isValidTransition, shouldAutoClose } from '../scheduling/workflow.js';
import { quoteSummary } from '../scheduling/quoteSummary.js';
import { syncNativeLegStatus } from '../scheduling/nativeLegStatus.js';
import { priceQuoteLegs, legMinutes } from '../scheduling/priceQuote.js';
import { recomputeFromInputs } from '../scheduling/pricing.js';
import { buildCrewArrays } from '../scheduling/crewAssignment.js';
import * as lf from '../services/levelflight.js';

const router = express.Router();

// Authorization gate for mutating scheduling routes (read routes stay open to any
// authenticated user). req.user.role comes from requireAuth (Supabase app_role).
function requireSchedulingEditor(req, res, next) {
  if (canEditScheduling(req.user?.role)) return next();
  return res.status(403).json({ error: 'You do not have permission to edit scheduling (requires a dispatcher / scheduler role).' });
}

// GET /api/scheduling/sync-status — mirror freshness for the dashboard indicator.
router.get('/sync-status', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('scheduling_sync_status')
      .select('entity, last_run_at, last_success_at, status, message, counts');
    if (error) throw error;
    res.json({ entities: formatSyncStatus(data || [], new Date().toISOString()) });
  } catch (e) {
    res.status(502).json({ error: e.message, entities: [] });
  }
});

// GET /api/scheduling/legs — mirrored legs (LevelFlight shape) for the read UI.
router.get('/legs', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('scheduling_legs')
      .select('lf_synced_snapshot, origin, locally_modified, upstream_changed');
    if (error) throw error;
    res.json({ legs: mirrorLegsFromRows(data) });
  } catch (e) {
    res.status(502).json({ error: e.message, legs: [] });
  }
});

// GET /api/scheduling/leg-estimate?from=KFXE&to=KTEB[&dep=ISO] — live distance +
// flight time for the quote builder, computed as soon as both airports are entered.
router.get('/leg-estimate', async (req, res) => {
  try {
    const from = String(req.query.from || '').trim().toUpperCase();
    const to = String(req.query.to || '').trim().toUpperCase();
    if (!from || !to) return res.status(400).json({ error: 'from and to are required' });
    const [t] = await legMinutes(null, [{ dep_icao: from, arr_icao: to }]);
    const known = t.distanceNm != null;
    const minutes = known ? Math.round(t.minutes) : null;
    const depMs = req.query.dep ? Date.parse(req.query.dep) : null;
    const arrTime = (known && depMs != null && Number.isFinite(depMs)) ? new Date(depMs + minutes * 60000).toISOString() : null;
    res.json({ from, to, distanceNm: known ? Math.round(t.distanceNm) : null, minutes, source: t.source, arrTime });
  } catch (e) {
    console.error('GET /api/scheduling/leg-estimate:', e.message);
    res.status(500).json({ error: 'Failed to estimate' });
  }
});

// GET /api/scheduling/crew-roster — the full crew list (pilots + flight attendants)
// for the assignment dropdowns. Built from LevelFlight: the pilot roster + everyone
// who appears as crew in mirrored leg snapshots (which is how flight attendants get
// in). Deduped by email/name, role tagged from cockpit seat (>=5 = cabin).
router.get('/crew-roster', async (req, res) => {
  try {
    const byKey = new Map();
    const add = (m, role) => {
      const firstName = (m.firstName || '').trim() || null;
      const lastName = (m.lastName || '').trim() || null;
      const name = [firstName, lastName].filter(Boolean).join(' ') || (m.email || '').trim();
      if (!name) return;
      const key = (m.email || name).toLowerCase();
      const existing = byKey.get(key);
      // Prefer a known role + a title if we get more than one record for someone.
      if (!existing) byKey.set(key, { firstName, lastName, name, title: m.title || null, email: m.email || null, role });
      else { if (!existing.title && m.title) existing.title = m.title; if (role === 'Cabin') existing.role = 'Cabin'; }
    };

    const unwrap = (d) => (Array.isArray(d) ? d : (d?.pilots || d?.attendants || d?.users || d?.data || d?.list || []));

    // 1) Full pilot roster from LevelFlight's directory (everyone, even never-flown).
    //    getPilots (admin) carries titles; pilots/list is the directory list.
    try { for (const u of unwrap(await lf.getPilots(1))) add(u, 'Pilot'); } catch (e) { console.warn('[crew-roster] pilots failed:', e?.message || e); }
    try { for (const u of unwrap(await lf.getPilotsList())) add(u, 'Pilot'); } catch (e) { console.warn('[crew-roster] pilots/list failed:', e?.message || e); }

    // 2) Full flight-attendant roster from LevelFlight's directory.
    try { for (const u of unwrap(await lf.getAttendants())) add(u, 'Cabin'); } catch (e) { console.warn('[crew-roster] attendants failed:', e?.message || e); }

    // 3) Anyone who appears as crew in mirrored leg snapshots — backfills titles
    //    (Chief Pilot, etc.) the directory lists omit, and catches anyone missed.
    const { data: legs } = await supabase.from('scheduling_legs').select('lf_synced_snapshot').eq('origin', 'levelflight');
    for (const r of legs || []) {
      const s = r.lf_synced_snapshot || {};
      for (const c of s.pilots || []) if (c?.user) add({ ...c.user }, c.seat >= 5 ? 'Cabin' : 'Pilot');
      for (const c of s.attendants || []) if (c?.user) add({ ...c.user }, 'Cabin');
    }

    const crew = [...byKey.values()].sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'Pilot' ? -1 : 1));
    res.json({ crew });
  } catch (e) {
    console.error('GET /api/scheduling/crew-roster:', e.message);
    res.status(502).json({ error: e.message, crew: [] });
  }
});

// GET /api/scheduling/quotes — trips at the working 'quote' stage, summarized for
// the Quotes list. Booking a quote (PATCH status='booked') moves it out of here.
router.get('/quotes', async (req, res) => {
  try {
    const { data: trips, error } = await supabase
      .from('scheduling_trips').select('id, lf_oid, trip_number, status, origin, pricing').eq('status', 'quote');
    if (error) throw error;
    if (!trips?.length) return res.json({ quotes: [] });
    const ids = trips.map((t) => t.id);
    const { data: legRows, error: le } = await supabase
      .from('scheduling_legs').select('trip_id, seq, lf_synced_snapshot').in('trip_id', ids).order('seq');
    if (le) throw le;
    const byTrip = new Map();
    for (const lr of legRows || []) {
      if (!byTrip.has(lr.trip_id)) byTrip.set(lr.trip_id, []);
      byTrip.get(lr.trip_id).push(lr.lf_synced_snapshot);
    }
    const quotes = trips.map((t) => ({
      id: t.id, lf_oid: t.lf_oid, trip_number: t.trip_number, total: t.pricing && !t.pricing.error ? t.pricing.total : null, ...quoteSummary(byTrip.get(t.id) || []),
    }));
    res.json({ quotes });
  } catch (e) {
    console.error('GET /api/scheduling/quotes:', e.message);
    res.status(502).json({ error: e.message, quotes: [] });
  }
});

const TRIP_COLS = 'lf_oid, trip_number, status, locally_modified, upstream_changed, lf_synced_snapshot, origin, pricing';

// PostgREST returns code PGRST116 from .single() when no row matched.
function isNotFound(error) {
  return error?.code === 'PGRST116';
}

// A trip is addressed by its LevelFlight oid (mirrored, 24-char hex) or, for
// native trips with no lf_oid, by its uuid id. Choose the right column.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function tripColumn(param) {
  return UUID_RE.test(param) ? 'id' : 'lf_oid';
}

// Shape a scheduling_trips row for the API (adds labels + the LF-original status).
function shapeTrip(row) {
  const orig = row.lf_synced_snapshot?.status ?? null;
  return {
    id: row.id,
    lf_oid: row.lf_oid,
    origin: row.origin,
    pricing: row.pricing,
    trip_number: row.trip_number,
    status: row.status,
    status_label: statusLabel(row.status),
    stage: workflowStage(row.status),
    actions: nextActions(row.status),
    original_status: orig,
    original_status_label: statusLabel(orig),
    locally_modified: row.locally_modified,
    upstream_changed: row.upstream_changed,
  };
}

// Build leg rows for a native trip from the submitted legs: compute each arrival
// from departure + the flight-time engine, and embed aircraft/customer/pax/ferry
// in a LevelFlight-shaped snapshot. Shared by create and edit.
async function buildNativeLegRows(tripId, ctx, inputLegs) {
  const cleaned = inputLegs.map((l) => ({
    dep_icao: (l.dep_icao || '').trim().toUpperCase() || null,
    arr_icao: (l.arr_icao || '').trim().toUpperCase() || null,
  }));
  const times = await legMinutes(null, cleaned);
  return inputLegs.map((l, i) => {
    const depMs = l.dep_time ? Date.parse(l.dep_time) : null;
    const arrMs = depMs != null && Number.isFinite(depMs) ? depMs + times[i].minutes * 60000 : null;
    const leg = {
      seq: i,
      dep_icao: cleaned[i].dep_icao,
      arr_icao: cleaned[i].arr_icao,
      dep_time: l.dep_time || null,
      arr_time: arrMs != null ? new Date(arrMs).toISOString() : null,
    };
    const snap = buildNativeLegSnapshot({ ...leg, pax: Number(l.pax) || 0, positioning: !!l.positioning }, ctx);
    return { trip_id: tripId, origin: 'native', ...leg, lf_synced_snapshot: snap };
  });
}

// Price a native trip from its input legs (best-effort) and persist the breakdown.
async function priceAndStore(tripId, aircraft_tail, inputLegs) {
  try {
    const pricing = await priceQuoteLegs({
      tail: aircraft_tail, aircraftType: null,
      legs: inputLegs.map((l) => ({ dep_icao: (l.dep_icao || '').trim().toUpperCase(), arr_icao: (l.arr_icao || '').trim().toUpperCase(), pax: Number(l.pax) || 0, isPositioning: !!l.positioning })),
      nights: 0,
    });
    await supabase.from('scheduling_trips').update({ pricing, rate_name: pricing.rateName || null }).eq('id', tripId);
  } catch (pe) { console.warn('[scheduling price] failed:', pe?.message || pe); }
}

// POST /api/scheduling/trips — create a NATIVE (created-here) trip + its legs.
// Each leg stores a LevelFlight-shaped snapshot so it renders in the same
// list/board/detail components as mirrored legs (no schema change needed).
router.post('/trips', requireSchedulingEditor, async (req, res) => {
  try {
    const body = req.body || {};
    const trip_number = (body.trip_number || '').trim() || null;
    const aircraft_tail = (body.aircraft_tail || '').trim() || null;
    const customer_name = (body.customer_name || '').trim() || null;
    const inputLegs = Array.isArray(body.legs) ? body.legs : [];
    if (!inputLegs.length) return res.status(400).json({ error: 'A trip needs at least one leg.' });

    const status = 'quote';
    const { data: trip, error: e1 } = await supabase
      .from('scheduling_trips')
      .insert({ origin: 'native', status, trip_number, modified_at: new Date().toISOString(), modified_by: req.user?.email || null })
      .select('id, ' + TRIP_COLS).single();
    if (e1) throw e1;

    const ctx = { id: trip.id, trip_number, status, aircraft_tail, customer_name };
    const legRows = await buildNativeLegRows(trip.id, ctx, inputLegs);
    const { error: e2 } = await supabase.from('scheduling_legs').insert(legRows);
    if (e2) throw e2;

    await priceAndStore(trip.id, aircraft_tail, inputLegs);

    res.status(201).json({ id: trip.id, trip: shapeTrip(trip) });
  } catch (e) {
    console.error('POST /api/scheduling/trips:', e.message);
    res.status(500).json({ error: 'Failed to create trip' });
  }
});

// PATCH /api/scheduling/trips/:lfOid/details — edit a native trip's aircraft,
// customer, and legs (add/remove/reorder). Replaces the leg set and re-prices.
// Native trips only (created-here quotes); mirrored trips are managed by LevelFlight.
router.patch('/trips/:lfOid/details', requireSchedulingEditor, async (req, res) => {
  try {
    const col = tripColumn(req.params.lfOid);
    const { data: trip, error } = await supabase
      .from('scheduling_trips').select('id, origin, trip_number, status').eq(col, req.params.lfOid).single();
    if (error) { if (isNotFound(error)) return res.status(404).json({ error: 'Trip not found' }); throw error; }
    if (trip.origin !== 'native') return res.status(400).json({ error: 'Only trips created here can have their details edited.' });

    const body = req.body || {};
    const aircraft_tail = (body.aircraft_tail || '').trim() || null;
    const customer_name = (body.customer_name || '').trim() || null;
    const inputLegs = Array.isArray(body.legs) ? body.legs : [];
    if (!inputLegs.length) return res.status(400).json({ error: 'A trip needs at least one leg.' });

    const ctx = { id: trip.id, trip_number: trip.trip_number, status: trip.status, aircraft_tail, customer_name };
    const legRows = await buildNativeLegRows(trip.id, ctx, inputLegs);
    // Replace the leg set: delete existing, insert the new ones.
    const { error: de } = await supabase.from('scheduling_legs').delete().eq('trip_id', trip.id);
    if (de) throw de;
    const { error: ie } = await supabase.from('scheduling_legs').insert(legRows);
    if (ie) throw ie;

    await supabase.from('scheduling_trips').update({ modified_at: new Date().toISOString(), modified_by: req.user?.email || null }).eq('id', trip.id);
    await priceAndStore(trip.id, aircraft_tail, inputLegs);
    res.json({ ok: true });
  } catch (e) {
    console.error('PATCH /api/scheduling/trips/:lfOid/details:', e.message);
    res.status(500).json({ error: 'Failed to update trip details' });
  }
});

// GET /api/scheduling/trips/:lfOid — one trip's status + provenance + its legs.
// Legs come from the mirror (not router state) so the page works on refresh /
// direct link.
router.get('/trips/:lfOid', async (req, res) => {
  try {
    const { data: row, error } = await supabase
      .from('scheduling_trips').select('id, ' + TRIP_COLS).eq(tripColumn(req.params.lfOid), req.params.lfOid).single();
    if (error) {
      if (isNotFound(error)) return res.status(404).json({ error: 'Trip not found' });
      throw error;
    }
    const { data: legRows, error: legErr } = await supabase
      .from('scheduling_legs')
      .select('lf_synced_snapshot, origin, locally_modified, upstream_changed')
      .eq('trip_id', row.id)
      .order('seq');
    if (legErr) throw legErr;
    const legs = mirrorLegsFromRows(legRows);

    // A released trip whose every leg has already arrived auto-closes on read.
    let trip = row;
    const arrMs = legs.map((l) => l.arrival?.time ?? null);
    if (shouldAutoClose(row.status, arrMs, new Date().toISOString())) {
      const { data: closed } = await supabase
        .from('scheduling_trips')
        .update({ status: 'closed', modified_at: new Date().toISOString() })
        .eq('id', row.id).select('id, ' + TRIP_COLS).single();
      if (closed) trip = closed;
      await syncNativeLegStatus(row.id, 'closed');
    }
    res.json({ trip: shapeTrip(trip), legs });
  } catch (e) {
    console.error('GET /api/scheduling/trips/:lfOid:', e.message);
    res.status(500).json({ error: 'Failed to load trip' });
  }
});

// PATCH /api/scheduling/trips/:lfOid — local-override the status (never touches LevelFlight).
router.patch('/trips/:lfOid', requireSchedulingEditor, async (req, res) => {
  try {
    const status = req.body?.status;
    if (!isSettableStatus(status)) return res.status(400).json({ error: 'invalid status' });
    const col = tripColumn(req.params.lfOid);
    const { data: cur, error: e0 } = await supabase
      .from('scheduling_trips').select('status, origin').eq(col, req.params.lfOid).single();
    if (e0) {
      if (isNotFound(e0)) return res.status(404).json({ error: 'Trip not found' });
      throw e0;
    }
    if (!isValidTransition(cur.status, status)) {
      return res.status(409).json({ error: `Cannot move to ${statusLabel(status)} from ${statusLabel(cur.status)}.` });
    }
    const { data, error } = await supabase
      .from('scheduling_trips')
      .update({ status, locally_modified: cur.origin === 'levelflight', modified_at: new Date().toISOString(), modified_by: req.user?.email || null })
      .eq(col, req.params.lfOid)
      .select('id, ' + TRIP_COLS).single();
    if (error) {
      if (isNotFound(error)) return res.status(404).json({ error: 'Trip not found' });
      throw error;
    }
    await syncNativeLegStatus(data.id, status); // keep native legs' list/board status in sync
    res.json({ trip: shapeTrip(data) });
  } catch (e) {
    console.error('PATCH /api/scheduling/trips/:lfOid:', e.message);
    res.status(500).json({ error: 'Failed to update trip' });
  }
});

// POST /api/scheduling/trips/:lfOid/price — recompute + store the quote breakdown.
router.post('/trips/:lfOid/price', requireSchedulingEditor, async (req, res) => {
  try {
    const col = tripColumn(req.params.lfOid);
    const { data: trip, error } = await supabase
      .from('scheduling_trips').select('id, lf_oid, status').eq(col, req.params.lfOid).single();
    if (error) { if (isNotFound(error)) return res.status(404).json({ error: 'Trip not found' }); throw error; }
    const { data: legs, error: le } = await supabase
      .from('scheduling_legs').select('dep_icao, arr_icao, lf_synced_snapshot').eq('trip_id', trip.id).order('seq');
    if (le) throw le;
    const tail = legs[0]?.lf_synced_snapshot?.dispatch?.aircraft?.tailNumber || null;
    const aircraftType = legs[0]?.lf_synced_snapshot?.dispatch?.aircraft?.type?.name || null;
    const nights = Number(req.body?.nights) || 0;
    const pricing = await priceQuoteLegs({
      tail, aircraftType,
      legs: legs.map((l) => ({
        dep_icao: l.dep_icao, arr_icao: l.arr_icao,
        pax: l.lf_synced_snapshot?.passengerCount || 0,
        isPositioning: !!l.lf_synced_snapshot?.isPositioning,
      })),
      nights,
    });
    await supabase.from('scheduling_trips').update({ pricing, rate_name: pricing.rateName || null }).eq('id', trip.id);
    res.json({ pricing });
  } catch (e) {
    console.error('POST /api/scheduling/trips/:lfOid/price:', e.message);
    res.status(500).json({ error: 'Failed to price trip' });
  }
});

// PATCH /api/scheduling/trips/:lfOid/price-lines — save a per-line adjusted breakdown
// (LevelFlight-style: every charge editable on the quote). Recomputes FET + total.
router.patch('/trips/:lfOid/price-lines', requireSchedulingEditor, async (req, res) => {
  try {
    const col = tripColumn(req.params.lfOid);
    const { data: trip, error } = await supabase
      .from('scheduling_trips').select('id, pricing').eq(col, req.params.lfOid).single();
    if (error) { if (isNotFound(error)) return res.status(404).json({ error: 'Trip not found' }); throw error; }
    const base = trip.pricing && !trip.pricing.error ? trip.pricing : {};
    const b = req.body || {};
    const pick = (k) => (b[k] === undefined || b[k] === null || b[k] === '' ? (Number(base[k]) || 0) : Number(b[k]) || 0);
    const inputs = {
      hourlyRate: pick('hourlyRate'), hours: pick('hours'), surchargePerHr: pick('surchargePerHr'),
      faFee: pick('faFee'), faCount: pick('faCount'), crewFee: pick('crewFee'), crewCount: pick('crewCount'),
      landingFee: pick('landingFee'), landings: pick('landings'),
      segmentPerPax: pick('segmentPerPax'), pax: pick('pax'), overnightCost: pick('overnightCost'),
      fetRate: base.fetRate || 0,
    };
    const pricing = { ...base, ...inputs, ...recomputeFromInputs(inputs), manual: true };
    await supabase.from('scheduling_trips').update({ pricing }).eq('id', trip.id);
    res.json({ pricing });
  } catch (e) {
    console.error('PATCH /api/scheduling/trips/:lfOid/price-lines:', e.message);
    res.status(500).json({ error: 'Failed to save pricing' });
  }
});

// PATCH /api/scheduling/trips/:lfOid/crew — assign PIC / SIC / Flight Attendant to
// the whole trip. Writes the crew into every leg's snapshot (seat 2/3/7) so it shows
// in the Crew list, itinerary, and trip sheet. Mirrored trips are flagged
// locally_modified so the edit is revertable.
router.patch('/trips/:lfOid/crew', requireSchedulingEditor, async (req, res) => {
  try {
    const col = tripColumn(req.params.lfOid);
    const { data: trip, error } = await supabase
      .from('scheduling_trips').select('id, origin').eq(col, req.params.lfOid).single();
    if (error) { if (isNotFound(error)) return res.status(404).json({ error: 'Trip not found' }); throw error; }

    const { pilots, attendants } = buildCrewArrays(req.body || {});
    const { data: legRows, error: le } = await supabase
      .from('scheduling_legs').select('id, lf_synced_snapshot').eq('trip_id', trip.id);
    if (le) throw le;
    for (const lr of legRows || []) {
      const snap = lr.lf_synced_snapshot || {};
      snap.pilots = pilots;
      snap.attendants = attendants;
      const patch = { lf_synced_snapshot: snap };
      if (trip.origin === 'levelflight') patch.locally_modified = true;
      const { error: ue } = await supabase.from('scheduling_legs').update(patch).eq('id', lr.id);
      if (ue) throw ue;
    }
    if (trip.origin === 'levelflight') {
      await supabase.from('scheduling_trips').update({ locally_modified: true, modified_at: new Date().toISOString(), modified_by: req.user?.email || null }).eq('id', trip.id);
    }
    res.json({ ok: true, pilots, attendants });
  } catch (e) {
    console.error('PATCH /api/scheduling/trips/:lfOid/crew:', e.message);
    res.status(500).json({ error: 'Failed to assign crew' });
  }
});

// Passenger columns we expose/accept.
const PAX_COLS = 'id, name, dob, weight_lbs, note, tsa_status';

// GET /api/scheduling/trips/:lfOid/passengers — the trip's passenger manifest.
router.get('/trips/:lfOid/passengers', async (req, res) => {
  try {
    const { data: trip, error } = await supabase
      .from('scheduling_trips').select('id').eq(tripColumn(req.params.lfOid), req.params.lfOid).single();
    if (error) { if (isNotFound(error)) return res.status(404).json({ error: 'Trip not found' }); throw error; }
    const { data, error: pe } = await supabase
      .from('scheduling_passengers').select(PAX_COLS).eq('trip_id', trip.id).order('name');
    if (pe) throw pe;
    res.json({ passengers: data || [] });
  } catch (e) {
    console.error('GET passengers:', e.message);
    res.status(500).json({ error: 'Failed to load passengers' });
  }
});

// PUT /api/scheduling/trips/:lfOid/passengers — replace the trip's manifest.
router.put('/trips/:lfOid/passengers', requireSchedulingEditor, async (req, res) => {
  try {
    const { data: trip, error } = await supabase
      .from('scheduling_trips').select('id').eq(tripColumn(req.params.lfOid), req.params.lfOid).single();
    if (error) { if (isNotFound(error)) return res.status(404).json({ error: 'Trip not found' }); throw error; }
    const list = Array.isArray(req.body?.passengers) ? req.body.passengers : [];
    const rows = list
      .filter((p) => (p.name || '').trim())
      .map((p) => ({
        trip_id: trip.id, origin: 'native',
        name: p.name.trim(),
        dob: p.dob || null,
        weight_lbs: p.weight_lbs === '' || p.weight_lbs == null ? null : Number(p.weight_lbs),
        note: (p.note || '').trim() || null,
        tsa_status: (p.tsa_status || '').trim() || null,
      }));
    const { error: de } = await supabase.from('scheduling_passengers').delete().eq('trip_id', trip.id);
    if (de) throw de;
    if (rows.length) { const { error: ie } = await supabase.from('scheduling_passengers').insert(rows); if (ie) throw ie; }
    const { data, error: se } = await supabase.from('scheduling_passengers').select(PAX_COLS).eq('trip_id', trip.id).order('name');
    if (se) throw se;
    res.json({ passengers: data || [] });
  } catch (e) {
    console.error('PUT passengers:', e.message);
    res.status(500).json({ error: 'Failed to save passengers' });
  }
});

// GET /api/scheduling/passengers/suggest — distinct previous passengers (for the
// "add from previous passengers" autocomplete).
router.get('/passengers/suggest', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('scheduling_passengers').select('name, dob, weight_lbs').not('name', 'is', null);
    if (error) throw error;
    const byName = new Map();
    for (const p of data || []) {
      const n = (p.name || '').trim(); if (!n) continue;
      if (!byName.has(n)) byName.set(n, { name: n, dob: p.dob || null, weight_lbs: p.weight_lbs ?? null });
    }
    res.json({ passengers: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)) });
  } catch (e) {
    res.status(502).json({ error: e.message, passengers: [] });
  }
});

const DOC_BUCKET = 'scheduling-docs';        // private Supabase Storage bucket
const DOC_COLS = 'id, name, doc_type, storage_path, content_type, size_bytes, created_at';
const safeName = (s) => String(s || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);

// GET /api/scheduling/trips/:lfOid/documents — list a trip's documents with
// short-lived signed download URLs.
router.get('/trips/:lfOid/documents', async (req, res) => {
  try {
    const { data: trip, error } = await supabase
      .from('scheduling_trips').select('id').eq(tripColumn(req.params.lfOid), req.params.lfOid).single();
    if (error) { if (isNotFound(error)) return res.status(404).json({ error: 'Trip not found' }); throw error; }
    const { data: rows, error: de } = await supabase
      .from('scheduling_documents').select(DOC_COLS).eq('trip_id', trip.id).order('created_at', { ascending: false });
    if (de) throw de;
    const docs = [];
    for (const d of rows || []) {
      const { data: signed } = await supabase.storage.from(DOC_BUCKET).createSignedUrl(d.storage_path, 3600);
      docs.push({ ...d, url: signed?.signedUrl || null });
    }
    res.json({ documents: docs });
  } catch (e) {
    console.error('GET documents:', e.message);
    res.status(500).json({ error: 'Failed to load documents' });
  }
});

// POST /api/scheduling/trips/:lfOid/documents — upload a document (base64 JSON, no
// multipart dependency). Body: { name, doc_type, content_type, data_base64 }.
router.post('/trips/:lfOid/documents', requireSchedulingEditor, express.json({ limit: '25mb' }), async (req, res) => {
  try {
    const { data: trip, error } = await supabase
      .from('scheduling_trips').select('id').eq(tripColumn(req.params.lfOid), req.params.lfOid).single();
    if (error) { if (isNotFound(error)) return res.status(404).json({ error: 'Trip not found' }); throw error; }
    const b = req.body || {};
    const name = safeName(b.name);
    const base64 = (b.data_base64 || '').replace(/^data:[^;]+;base64,/, '');
    if (!base64) return res.status(400).json({ error: 'No file data' });
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length) return res.status(400).json({ error: 'Empty file' });
    const storage_path = `${trip.id}/${Date.now()}-${name}`;
    const { error: ue } = await supabase.storage.from(DOC_BUCKET)
      .upload(storage_path, buffer, { contentType: b.content_type || 'application/octet-stream', upsert: false });
    if (ue) {
      if (/bucket/i.test(ue.message)) return res.status(500).json({ error: `Storage bucket "${DOC_BUCKET}" is missing — create it (private) in Supabase.` });
      throw ue;
    }
    const { data: row, error: ie } = await supabase.from('scheduling_documents').insert({
      trip_id: trip.id, name, doc_type: (b.doc_type || 'other').trim() || 'other',
      storage_path, content_type: b.content_type || null, size_bytes: buffer.length, uploaded_by: req.user?.email || null,
    }).select(DOC_COLS).single();
    if (ie) throw ie;
    res.status(201).json({ document: row });
  } catch (e) {
    console.error('POST documents:', e.message);
    res.status(500).json({ error: 'Failed to upload document' });
  }
});

// DELETE /api/scheduling/documents/:id — remove a document (storage + row).
router.delete('/documents/:id', requireSchedulingEditor, async (req, res) => {
  try {
    const { data: doc, error } = await supabase
      .from('scheduling_documents').select('id, storage_path').eq('id', req.params.id).single();
    if (error) { if (isNotFound(error)) return res.status(404).json({ error: 'Document not found' }); throw error; }
    await supabase.storage.from(DOC_BUCKET).remove([doc.storage_path]);
    const { error: de } = await supabase.from('scheduling_documents').delete().eq('id', doc.id);
    if (de) throw de;
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE document:', e.message);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// POST /api/scheduling/trips/:lfOid/revert — restore the working copy from the LF snapshot.
router.post('/trips/:lfOid/revert', requireSchedulingEditor, async (req, res) => {
  try {
    const col = tripColumn(req.params.lfOid);
    const { data: cur, error: e1 } = await supabase
      .from('scheduling_trips').select('lf_synced_snapshot').eq(col, req.params.lfOid).single();
    if (e1) {
      if (isNotFound(e1)) return res.status(404).json({ error: 'Trip not found' });
      throw e1;
    }
    if (!cur.lf_synced_snapshot) return res.status(400).json({ error: 'This trip has no LevelFlight version to revert to.' });
    const cols = tripColumnsFromSnapshot(cur.lf_synced_snapshot);
    const { data, error } = await supabase
      .from('scheduling_trips')
      .update({ ...cols, locally_modified: false, upstream_changed: false, modified_by: null, modified_at: new Date().toISOString() })
      .eq(col, req.params.lfOid)
      .select('id, ' + TRIP_COLS).single();
    if (error) {
      if (isNotFound(error)) return res.status(404).json({ error: 'Trip not found' });
      throw error;
    }
    res.json({ trip: shapeTrip(data) });
  } catch (e) {
    console.error('POST /api/scheduling/trips/:lfOid/revert:', e.message);
    res.status(500).json({ error: 'Failed to revert trip' });
  }
});

export default router;
