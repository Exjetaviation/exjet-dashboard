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
import { documentAlerts } from '../scheduling/docExpiry.js';
import { rankPeople } from '../scheduling/peopleSearch.js';
import { priceQuoteLegs, legMinutes } from '../scheduling/priceQuote.js';
import { nextQuoteNumber, nextTripNumber } from '../scheduling/numbering.js';
import { recomputeFromInputs, repriceFromBase, computeFlightCost } from '../scheduling/pricing.js';
import { tripParamColumn } from '../scheduling/tripParam.js';
import { buildCrewArrays } from '../scheduling/crewAssignment.js';
import { defaultAirportIndex, searchAirports } from '../scheduling/airportSearch.js';
import * as lf from '../services/levelflight.js';
import { fetchAirportFbos, listFbos, upsertFbos } from '../services/fbos.js';
import { sendEmail } from '../services/gmail.js';
import { buildItinerary } from '../services/itineraryData.js';
import { buildNativeItineraryVM } from '../services/nativeItineraryData.js';
import { renderItineraryHtml } from '../services/itineraryHtml.js';
import { renderQuotePdf } from '../services/quotePdf.js';
import { buildItineraryEmail } from '../services/itineraryEmail.js';

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

// GET /api/scheduling/airport/:icao/fbos — FBOs from our directory; lazily fetch +
// cache from LevelFlight on the first request for an airport we haven't imported.
router.get('/airport/:icao/fbos', async (req, res) => {
  try {
    const icao = (req.params.icao || '').trim().toUpperCase();
    let fbos = await listFbos(icao);
    if (!fbos.length) {
      const rows = await fetchAirportFbos(icao).catch(() => []);
      if (rows.length) { await upsertFbos(rows).catch(() => {}); fbos = rows; }
    }
    res.json({ icao, fbos });
  } catch (e) {
    console.error('GET /api/scheduling/airport/:icao/fbos:', e.message);
    res.status(500).json({ error: 'Failed to load FBOs' });
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
      .from('scheduling_trips').select('id, lf_oid, trip_number, quote_number, status, origin, pricing').eq('status', 'quote');
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
      id: t.id, lf_oid: t.lf_oid, trip_number: t.trip_number, quote_number: t.quote_number, total: t.pricing && !t.pricing.error ? t.pricing.total : null, ...quoteSummary(byTrip.get(t.id) || []),
    }));
    res.json({ quotes });
  } catch (e) {
    console.error('GET /api/scheduling/quotes:', e.message);
    res.status(502).json({ error: e.message, quotes: [] });
  }
});

const TRIP_COLS = 'lf_oid, trip_number, quote_number, status, purpose, rate_name, company_name, contact, checklist, booked_by, booked_at, locally_modified, upstream_changed, lf_synced_snapshot, origin, pricing';

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
const buildItinVM = (id) => (UUID_RE.test(id) ? buildNativeItineraryVM(id) : buildItinerary(id));

// Shape a scheduling_trips row for the API (adds labels + the LF-original status).
function shapeTrip(row) {
  const orig = row.lf_synced_snapshot?.status ?? null;
  return {
    id: row.id,
    lf_oid: row.lf_oid,
    origin: row.origin,
    pricing: row.pricing,
    quote_number: row.quote_number,
    purpose: row.purpose,
    rate_name: row.rate_name,
    company_name: row.company_name,
    contact: row.contact,
    checklist: row.checklist || null,
    booked_by: row.booked_by,
    booked_at: row.booked_at,
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
    const snap = buildNativeLegSnapshot({ ...leg, pax: Number(l.pax) || 0, positioning: !!l.positioning, dep_fbo: l.dep_fbo || null, arr_fbo: l.arr_fbo || null }, ctx);
    return { trip_id: tripId, origin: 'native', ...leg, lf_synced_snapshot: snap };
  });
}

// Price a native trip from its input legs (best-effort) and persist the breakdown.
// A reprice keeps any manual ad-hoc fees / FET-off / total override the quote
// already had (repriceFromBase). Returns the stored pricing (or null on failure).
async function priceAndStore(tripId, aircraft_tail, inputLegs, purpose = null) {
  try {
    const fresh = await priceQuoteLegs({
      tail: aircraft_tail, aircraftType: null,
      legs: inputLegs.map((l) => ({ dep_icao: (l.dep_icao || '').trim().toUpperCase(), arr_icao: (l.arr_icao || '').trim().toUpperCase(), pax: Number(l.pax) || 0, isPositioning: !!l.positioning })),
      nights: 0, purpose,
    });
    const { data: cur } = await supabase.from('scheduling_trips').select('pricing').eq('id', tripId).single();
    const pricing = repriceFromBase(fresh, cur?.pricing || {});
    await supabase.from('scheduling_trips').update({ pricing, rate_name: pricing.rateName || null }).eq('id', tripId);
    return pricing;
  } catch (pe) { console.warn('[scheduling price] failed:', pe?.message || pe); return null; }
}

// POST /api/scheduling/quote-preview — price legs WITHOUT persisting, for the
// New-Quote page's live total. Same engine as create (priceQuoteLegs).
router.post('/quote-preview', requireSchedulingEditor, async (req, res) => {
  try {
    const b = req.body || {};
    const legs = Array.isArray(b.legs) ? b.legs : [];
    if (!legs.length) return res.json({ pricing: null });
    const pricing = await priceQuoteLegs({
      tail: (b.aircraft_tail || '').trim() || null,
      aircraftType: null,
      legs: legs.map((l) => ({
        dep_icao: (l.dep_icao || '').trim().toUpperCase(),
        arr_icao: (l.arr_icao || '').trim().toUpperCase(),
        pax: Number(l.pax) || 0,
        isPositioning: !!l.positioning,
      })),
      nights: Number(b.nights) || 0,
      purpose: (b.purpose || '').trim() || null,
    });
    res.json({ pricing });
  } catch (e) {
    console.error('POST /api/scheduling/quote-preview:', e.message);
    res.status(500).json({ error: 'Failed to price' });
  }
});

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

    const purpose = (body.purpose || '').trim() || null;          // 'owner' | 'charter' | null
    const company_name = (body.company_name || '').trim() || null;
    const contact = body.contact && typeof body.contact === 'object' && !Array.isArray(body.contact) ? body.contact : null;
    const quote_number = await nextQuoteNumber();

    const status = 'quote';
    const { data: trip, error: e1 } = await supabase
      .from('scheduling_trips')
      .insert({ origin: 'native', status, trip_number, quote_number: String(quote_number), purpose, company_name, contact, modified_at: new Date().toISOString(), modified_by: req.user?.email || null })
      .select('id, ' + TRIP_COLS).single();
    if (e1) throw e1;

    const ctx = { id: trip.id, trip_number, status, aircraft_tail, customer_name };
    const legRows = await buildNativeLegRows(trip.id, ctx, inputLegs);
    const { error: e2 } = await supabase.from('scheduling_legs').insert(legRows);
    if (e2) throw e2;

    await priceAndStore(trip.id, aircraft_tail, inputLegs, purpose);

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
      .from('scheduling_trips').select('id, origin, trip_number, status, purpose').eq(col, req.params.lfOid).single();
    if (error) { if (isNotFound(error)) return res.status(404).json({ error: 'Trip not found' }); throw error; }
    if (trip.origin !== 'native') return res.status(400).json({ error: 'Only trips created here can have their details edited.' });

    const body = req.body || {};
    const aircraft_tail = (body.aircraft_tail || '').trim() || null;
    const customer_name = (body.customer_name || '').trim() || null;
    const inputLegs = Array.isArray(body.legs) ? body.legs : [];
    if (!inputLegs.length) return res.status(400).json({ error: 'A trip needs at least one leg.' });

    // Editable quote header fields (only applied when present in the body).
    const tripPatch = { modified_at: new Date().toISOString(), modified_by: req.user?.email || null };
    if ('purpose' in body) tripPatch.purpose = (body.purpose || '').trim() || null;
    if ('company_name' in body) tripPatch.company_name = (body.company_name || '').trim() || null;
    if ('contact' in body) tripPatch.contact = (body.contact && typeof body.contact === 'object' && !Array.isArray(body.contact)) ? body.contact : null;
    const purpose = 'purpose' in body ? tripPatch.purpose : trip.purpose;

    const ctx = { id: trip.id, trip_number: trip.trip_number, status: trip.status, aircraft_tail, customer_name };
    const legRows = await buildNativeLegRows(trip.id, ctx, inputLegs);
    // Replace the leg set: delete existing, insert the new ones.
    const { error: de } = await supabase.from('scheduling_legs').delete().eq('trip_id', trip.id);
    if (de) throw de;
    const { error: ie } = await supabase.from('scheduling_legs').insert(legRows);
    if (ie) throw ie;

    await supabase.from('scheduling_trips').update(tripPatch).eq('id', trip.id);
    const pricing = await priceAndStore(trip.id, aircraft_tail, inputLegs, purpose);
    res.json({ ok: true, pricing });
  } catch (e) {
    console.error('PATCH /api/scheduling/trips/:lfOid/details:', e.message);
    res.status(500).json({ error: 'Failed to update trip details' });
  }
});

// GET /api/scheduling/quotes/:quoteNumber — resolve a quote by its Quote # and
// return the same { trip, legs } payload as GET /trips/:id (powers the QuoteEditor).
router.get('/quotes/:quoteNumber', async (req, res) => {
  try {
    const { data: row, error } = await supabase
      .from('scheduling_trips').select('id, ' + TRIP_COLS).eq('quote_number', String(req.params.quoteNumber)).limit(1).maybeSingle();
    if (error) throw error;
    if (!row) return res.status(404).json({ error: 'Quote not found' });
    const { data: legRows, error: legErr } = await supabase
      .from('scheduling_legs')
      .select('lf_synced_snapshot, origin, locally_modified, upstream_changed')
      .eq('trip_id', row.id)
      .order('seq');
    if (legErr) throw legErr;
    res.json({ trip: shapeTrip(row), legs: mirrorLegsFromRows(legRows) });
  } catch (e) {
    console.error('GET /api/scheduling/quotes/:quoteNumber:', e.message);
    res.status(500).json({ error: 'Failed to load quote' });
  }
});

// GET /api/scheduling/trips/:lfOid — one trip's status + provenance + its legs.
// Legs come from the mirror (not router state) so the page works on refresh /
// direct link.
router.get('/trips/:lfOid', async (req, res) => {
  try {
    const { data: row, error } = await supabase
      .from('scheduling_trips').select('id, ' + TRIP_COLS).eq(tripParamColumn(req.params.lfOid), req.params.lfOid).single();
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
      .from('scheduling_trips').select('status, origin, trip_number').eq(col, req.params.lfOid).single();
    if (e0) {
      if (isNotFound(e0)) return res.status(404).json({ error: 'Trip not found' });
      throw e0;
    }
    if (!isValidTransition(cur.status, status)) {
      return res.status(409).json({ error: `Cannot move to ${statusLabel(status)} from ${statusLabel(cur.status)}.` });
    }
    const extra = {};
    if (status === 'booked') {
      extra.booked_by = req.user?.email || null;
      extra.booked_at = new Date().toISOString();
      // assign a Trip# once, only if it doesn't already have one (read from the preflight `cur`)
      if (!cur.trip_number) extra.trip_number = String(await nextTripNumber());
    }
    const { data, error } = await supabase
      .from('scheduling_trips')
      .update({ status, locally_modified: cur.origin === 'levelflight', modified_at: new Date().toISOString(), modified_by: req.user?.email || null, ...extra })
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

// DELETE /api/scheduling/trips/:lfOid — permanently remove a NATIVE (created-here)
// trip and everything under it (legs/crew/passengers/documents cascade via FK).
// Mirrored LevelFlight trips can't be deleted here (they'd just re-sync) — cancel those.
router.delete('/trips/:lfOid', requireSchedulingEditor, async (req, res) => {
  try {
    const col = tripColumn(req.params.lfOid);
    const { data: trip, error } = await supabase
      .from('scheduling_trips').select('id, origin').eq(col, req.params.lfOid).single();
    if (error) { if (isNotFound(error)) return res.status(404).json({ error: 'Trip not found' }); throw error; }
    if (trip.origin !== 'native') {
      return res.status(400).json({ error: 'Only trips created here can be deleted. Cancel a LevelFlight trip instead.' });
    }
    // Best-effort: remove the trip's document files from storage (rows cascade with the trip).
    const { data: docs } = await supabase.from('scheduling_documents').select('storage_path').eq('trip_id', trip.id);
    const paths = (docs || []).map((d) => d.storage_path).filter(Boolean);
    if (paths.length) await supabase.storage.from(DOC_BUCKET).remove(paths);
    const { error: de } = await supabase.from('scheduling_trips').delete().eq('id', trip.id);
    if (de) throw de;
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/scheduling/trips/:lfOid:', e.message);
    res.status(500).json({ error: 'Failed to delete trip' });
  }
});

// GET /api/scheduling/trips/:lfOid/itinerary/email-preview?name= — render the
// formatted itinerary email (subject + HTML + summary) so the dispatcher can review
// it before sending. :lfOid is the dispatch/itinerary id.
router.get('/trips/:lfOid/itinerary/email-preview', async (req, res) => {
  try {
    const vm = await buildItinVM(req.params.lfOid);
    if (!vm) return res.status(404).json({ error: 'No itinerary available for this trip.' });
    const base = `${req.protocol}://${req.get('host')}`;
    res.json(buildItineraryEmail(vm, { recipientName: req.query.name, link: `${base}/itinerary/${req.params.lfOid}`, logoUrl: `${base}/itinerary/email-logo.png` }));
  } catch (e) {
    console.error('GET itinerary email-preview:', e.message);
    res.status(500).json({ error: e.message || 'Failed to build itinerary email' });
  }
});

// POST /api/scheduling/trips/:lfOid/itinerary/send  body { to, cc, recipientName }
// — email the formatted passenger itinerary (HTML) with the PDF attached, via the
// Exjet Gmail. `cc` sends a copy (comma-separate multiple). Auth-only (like the quote send-link).
router.post('/trips/:lfOid/itinerary/send', async (req, res) => {
  try {
    const to = (req.body?.to || '').trim();
    const cc = (req.body?.cc || '').trim();
    if (!to) return res.status(400).json({ error: 'Recipient email required' });
    const vm = await buildItinVM(req.params.lfOid);
    if (!vm) return res.status(404).json({ error: 'No itinerary available for this trip.' });
    const base = `${req.protocol}://${req.get('host')}`;
    const { subject, html } = buildItineraryEmail(vm, { recipientName: req.body?.recipientName, link: `${base}/itinerary/${req.params.lfOid}`, logoUrl: `${base}/itinerary/email-logo.png` });
    // Attach the itinerary PDF (best-effort — still send the formatted email if the
    // PDF renderer is unavailable).
    let attachments = [];
    try {
      const pdf = await renderQuotePdf(renderItineraryHtml(vm, { print: true }));
      attachments = [{ filename: `exjet-itinerary-${vm.tripNumber || req.params.lfOid}.pdf`, content: pdf, contentType: 'application/pdf' }];
    } catch (e) { console.warn('[itinerary send] PDF attach failed, sending without:', e?.message || e); }
    await sendEmail({ to, cc: cc || undefined, subject, html, attachments });
    res.json({ success: true });
  } catch (e) {
    console.error('POST itinerary/send:', e.message);
    res.status(500).json({ error: e.message || 'Failed to send itinerary' });
  }
});

// POST /api/scheduling/trips/:lfOid/price — recompute + store the quote breakdown.
router.post('/trips/:lfOid/price', requireSchedulingEditor, async (req, res) => {
  try {
    const col = tripColumn(req.params.lfOid);
    const { data: trip, error } = await supabase
      .from('scheduling_trips').select('id, lf_oid, status, purpose').eq(col, req.params.lfOid).single();
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
      nights, purpose: trip.purpose,
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

    // Recompute the per-leg flight cost when Cost/Hr or Pos/Hr changed (and the flight
    // line isn't pinned); otherwise keep the stored flightCost.
    const overrides = (b.overrides && typeof b.overrides === 'object') ? b.overrides : (base.overrides || {});
    const costPerHr = b.costPerHr === undefined ? (Number(base.costPerHr) || 0) : Number(b.costPerHr) || 0;
    const posRate = b.posRate === undefined ? (Number(base.posRate) || 0) : Number(b.posRate) || 0;
    let flightCost = Number(base.flightCost) || 0;
    let hours = Number(base.hours) || 0;
    const flightPinned = overrides.flightCost !== undefined && overrides.flightCost !== null && overrides.flightCost !== '';
    const ratesChanged = (b.costPerHr !== undefined && Number(b.costPerHr) !== (Number(base.costPerHr) || 0))
      || (b.posRate !== undefined && Number(b.posRate) !== (Number(base.posRate) || 0));
    if (ratesChanged && !flightPinned) {
      const { data: legRows } = await supabase
        .from('scheduling_legs').select('dep_icao, arr_icao, lf_synced_snapshot').eq('trip_id', trip.id).order('seq');
      const legInputs = (legRows || []).map((l) => ({ dep_icao: l.dep_icao, arr_icao: l.arr_icao, isPositioning: !!l.lf_synced_snapshot?.isPositioning }));
      const times = await legMinutes(null, legInputs);
      const tail = base.tail || legRows?.[0]?.lf_synced_snapshot?.dispatch?.aircraft?.tailNumber || null;
      const { data: cards } = await supabase.from('rate_cards').select('*').eq('aircraft_tail', tail);
      const rateCard = (cards || [])[0] || {};
      const legs = legInputs.map((l, idx) => ({ mins: times[idx].minutes, isPositioning: l.isPositioning }));
      const fc = computeFlightCost(legs, rateCard, { costPerHr, posRate });
      flightCost = fc.flightCost; hours = fc.hours || hours;
    }

    const inputs = {
      flightCost, hours, costPerHr, posRate,
      surchargePerHr: pick('surchargePerHr'),
      faFee: pick('faFee'), faCount: pick('faCount'), crewFee: pick('crewFee'), crewCount: pick('crewCount'),
      landingFee: pick('landingFee'), landings: pick('landings'),
      segmentPerPax: pick('segmentPerPax'), pax: pick('pax'),
      nights: pick('nights'), overnightRate: Number(base.overnightRate) || 0, overnightThreshold: Number(base.overnightThreshold) || 0,
      overnightCost: pick('overnightCost'),
      fetRate: base.fetRate || 0,
      fees: Array.isArray(b.fees) ? b.fees : (base.fees || []),
      fetEnabled: b.fetEnabled === undefined ? (base.fetEnabled !== false) : !!b.fetEnabled,
      totalOverride: b.totalOverride === undefined ? (base.totalOverride ?? null) : b.totalOverride,
      overrides,
    };
    const pricing = { ...base, ...inputs, ...recomputeFromInputs(inputs), overrides, costPerHr, posRate, manual: true };
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

// PATCH /api/scheduling/trips/:lfOid/checklist — persist the dispatch checklist booleans.
router.patch('/trips/:lfOid/checklist', requireSchedulingEditor, async (req, res) => {
  try {
    const col = tripColumn(req.params.lfOid);
    const { data: trip, error } = await supabase
      .from('scheduling_trips').select('id, checklist').eq(col, req.params.lfOid).single();
    if (error) { if (isNotFound(error)) return res.status(404).json({ error: 'Trip not found' }); throw error; }
    const b = req.body || {};
    const bool = (k, prev) => (typeof b[k] === 'boolean' ? b[k] : !!prev);
    const prev = trip.checklist || {};
    const checklist = {
      contractReceived: bool('contractReceived', prev.contractReceived),
      paymentReceived: bool('paymentReceived', prev.paymentReceived),
      paymentProcessed: bool('paymentProcessed', prev.paymentProcessed),
    };
    await supabase.from('scheduling_trips').update({ checklist }).eq('id', trip.id);
    res.json({ checklist });
  } catch (e) {
    console.error('PATCH /api/scheduling/trips/:lfOid/checklist:', e.message);
    res.status(500).json({ error: 'Failed to save checklist' });
  }
});

const PERSON_COLS = 'id, first_name, middle_name, last_name, dob, gender, nationality, citizenship, weight_lbs, email, phone, passport_number, passport_country, passport_expiry, green_card_number, green_card_expiry, visa_number, visa_expiry, known_traveler_number, redress_number, notes, origin, lf_oid, created_at, updated_at';

// Leg departure times are epoch ms for native legs but ISO strings for mirrored
// LF legs — normalize to ms so documentAlerts (which compares to Date.now()) works
// for both. Returns null for missing/unparseable values.
function toMs(v) {
  if (v == null) return null;
  const ms = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

// GET /api/scheduling/people?q=&limit= — passenger directory search. Returns
// summaries with trip count + expiry alerts for the directory list.
router.get('/people', async (req, res) => {
  try {
    // Cap at 200 so the per-person aggregation's `.in(person_id, …)` query stays
    // within URL length limits even with a large directory. The list is
    // search-driven; `total` lets the UI show the full directory size.
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 200);
    const { data: all, error } = await supabase.from('scheduling_people').select(PERSON_COLS).order('last_name').order('first_name');
    if (error) throw error;
    const ranked = rankPeople(all || [], req.query.q, limit);
    const ids = ranked.map((p) => p.id);

    // Trip counts + each person's upcoming trip dates (for expiry alerts).
    const counts = {};
    const datesById = {};
    if (ids.length) {
      const { data: paxRows } = await supabase
        .from('scheduling_passengers').select('person_id, trip_id').in('person_id', ids);
      const tripIds = [...new Set((paxRows || []).map((r) => r.trip_id))];
      const { data: legRows } = tripIds.length
        ? await supabase.from('scheduling_legs').select('trip_id, seq, lf_synced_snapshot').in('trip_id', tripIds).order('seq')
        : { data: [] };
      const startByTrip = {};
      for (const l of legRows || []) if (startByTrip[l.trip_id] == null) startByTrip[l.trip_id] = toMs(l.lf_synced_snapshot?.departure?.time);
      const tripsByPerson = {};
      for (const r of paxRows || []) (tripsByPerson[r.person_id] ||= new Set()).add(r.trip_id);
      for (const id of ids) {
        const tset = tripsByPerson[id] || new Set();
        counts[id] = tset.size;
        datesById[id] = [...tset].map((t) => startByTrip[t]).filter((v) => v != null);
      }
    }

    res.json({ total: (all || []).length, shown: ranked.length, people: ranked.map((p) => ({
      id: p.id, first_name: p.first_name, middle_name: p.middle_name, last_name: p.last_name, dob: p.dob,
      hasPassport: !!p.passport_number, tripCount: counts[p.id] || 0, alerts: documentAlerts(p, datesById[p.id] || []),
    })) });
  } catch (e) {
    console.error('GET people:', e.message);
    res.status(502).json({ error: e.message, people: [] });
  }
});

// GET /api/scheduling/people/:id — full profile: person, their documents (signed
// URLs), trip history, and expiry alerts.
router.get('/people/:id', async (req, res) => {
  try {
    const { data: person, error } = await supabase
      .from('scheduling_people').select(PERSON_COLS).eq('id', req.params.id).single();
    if (error) { if (isNotFound(error)) return res.status(404).json({ error: 'Person not found' }); throw error; }

    // Trips this person is on (via the per-trip manifest join).
    const { data: paxRows } = await supabase
      .from('scheduling_passengers').select('trip_id').eq('person_id', person.id);
    const tripIds = [...new Set((paxRows || []).map((r) => r.trip_id))];
    const trips = [];
    const tripDates = [];
    if (tripIds.length) {
      const { data: tripRows } = await supabase
        .from('scheduling_trips').select('id, lf_oid, trip_number, status').in('id', tripIds);
      const { data: legRows } = await supabase
        .from('scheduling_legs').select('trip_id, seq, lf_synced_snapshot').in('trip_id', tripIds).order('seq');
      const byTrip = new Map();
      for (const l of legRows || []) { const a = byTrip.get(l.trip_id) || []; a.push(l.lf_synced_snapshot); byTrip.set(l.trip_id, a); }
      for (const t of tripRows || []) {
        const s = quoteSummary((byTrip.get(t.id) || []).filter(Boolean));
        const startMs = toMs(s.start);
        if (startMs != null) tripDates.push(startMs);
        trips.push({ id: t.id, ref: t.lf_oid || t.id, trip_number: t.trip_number, status: t.status, route: s.route, start: s.start });
      }
      trips.sort((a, b) => (b.start || 0) - (a.start || 0));
    }

    // Person documents with short-lived signed URLs.
    const { data: docRows } = await supabase
      .from('scheduling_documents').select(DOC_COLS).eq('person_id', person.id).order('created_at', { ascending: false });
    const documents = [];
    for (const d of docRows || []) {
      const { data: signed } = await supabase.storage.from(DOC_BUCKET).createSignedUrl(d.storage_path, 3600);
      documents.push({ ...d, url: signed?.signedUrl || null });
    }

    res.json({ person, trips, documents, alerts: documentAlerts(person, tripDates) });
  } catch (e) {
    console.error('GET person:', e.message);
    res.status(500).json({ error: 'Failed to load person' });
  }
});

// Person fields a client may write.
const PERSON_WRITABLE = ['first_name', 'middle_name', 'last_name', 'dob', 'gender', 'nationality',
  'citizenship', 'weight_lbs', 'email', 'phone', 'passport_number', 'passport_country', 'passport_expiry',
  'green_card_number', 'green_card_expiry', 'visa_number', 'visa_expiry', 'known_traveler_number',
  'redress_number', 'notes'];

function personFields(body) {
  const out = {};
  for (const k of PERSON_WRITABLE) {
    if (!(k in body)) continue;
    let v = body[k];
    if (typeof v === 'string') v = v.trim();
    if (v === '') v = null;
    if (k === 'weight_lbs') { const n = v == null ? null : Number(v); v = Number.isFinite(n) ? n : null; }
    out[k] = v;
  }
  return out;
}

// POST /api/scheduling/people — create a person.
router.post('/people', requireSchedulingEditor, async (req, res) => {
  try {
    const fields = personFields(req.body || {});
    if (!fields.first_name && !fields.last_name) return res.status(400).json({ error: 'A name is required' });
    const { data, error } = await supabase.from('scheduling_people')
      .insert({ ...fields, origin: 'native', modified_by: req.user?.email || null, modified_at: new Date().toISOString() })
      .select(PERSON_COLS).single();
    if (error) throw error;
    res.status(201).json({ person: data });
  } catch (e) { console.error('POST person:', e.message); res.status(500).json({ error: 'Failed to create person' }); }
});

// PATCH /api/scheduling/people/:id — update a person.
router.patch('/people/:id', requireSchedulingEditor, async (req, res) => {
  try {
    const fields = personFields(req.body || {});
    const { data, error } = await supabase.from('scheduling_people')
      .update({ ...fields, modified_by: req.user?.email || null, modified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', req.params.id).select(PERSON_COLS).single();
    if (error) { if (isNotFound(error)) return res.status(404).json({ error: 'Person not found' }); throw error; }
    res.json({ person: data });
  } catch (e) { console.error('PATCH person:', e.message); res.status(500).json({ error: 'Failed to update person' }); }
});

// DELETE /api/scheduling/people/:id — remove a person (only if on no trips).
router.delete('/people/:id', requireSchedulingEditor, async (req, res) => {
  try {
    const { count } = await supabase.from('scheduling_passengers')
      .select('id', { count: 'exact', head: true }).eq('person_id', req.params.id);
    if (count && count > 0) return res.status(409).json({ error: `Can't delete — this person is on ${count} trip${count === 1 ? '' : 's'}. Remove them from those trips first.` });
    // Clean up their document files, then the person (docs cascade via FK).
    const { data: docRows } = await supabase.from('scheduling_documents').select('storage_path').eq('person_id', req.params.id);
    const paths = (docRows || []).map((d) => d.storage_path).filter(Boolean);
    if (paths.length) await supabase.storage.from(DOC_BUCKET).remove(paths);
    const { error } = await supabase.from('scheduling_people').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { console.error('DELETE person:', e.message); res.status(500).json({ error: 'Failed to delete person' }); }
});

// Per-trip passenger row + the joined person. Identity comes from the person;
// only seat/bags/TSA/note are per-trip.
const PAX_SELECT = 'id, person_id, seat, cargo_lbs, tsa_status, note, ' +
  'person:scheduling_people(id, first_name, middle_name, last_name, dob, weight_lbs, passport_number, passport_expiry, visa_expiry, green_card_expiry)';

function shapePax(row) {
  const p = row.person || {};
  return {
    id: row.id, person_id: row.person_id,
    first_name: p.first_name, middle_name: p.middle_name, last_name: p.last_name,
    name: [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' '),
    dob: p.dob ?? null, weight_lbs: p.weight_lbs ?? null,
    seat: row.seat ?? null, cargo_lbs: row.cargo_lbs ?? null, tsa_status: row.tsa_status ?? null, note: row.note ?? null,
    hasPassport: !!p.passport_number,
  };
}

// GET /api/scheduling/trips/:lfOid/passengers — manifest with joined person.
router.get('/trips/:lfOid/passengers', async (req, res) => {
  try {
    const { data: trip, error } = await supabase
      .from('scheduling_trips').select('id').eq(tripColumn(req.params.lfOid), req.params.lfOid).single();
    if (error) { if (isNotFound(error)) return res.status(404).json({ error: 'Trip not found' }); throw error; }
    const { data, error: pe } = await supabase
      .from('scheduling_passengers').select(PAX_SELECT).eq('trip_id', trip.id);
    if (pe) throw pe;
    const passengers = (data || []).map(shapePax).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    res.json({ passengers });
  } catch (e) {
    console.error('GET passengers:', e.message);
    res.status(500).json({ error: 'Failed to load passengers' });
  }
});

// PUT /api/scheduling/trips/:lfOid/passengers — replace the manifest. Each row
// references a person (person_id) and carries only per-trip fields.
router.put('/trips/:lfOid/passengers', requireSchedulingEditor, async (req, res) => {
  try {
    const { data: trip, error } = await supabase
      .from('scheduling_trips').select('id').eq(tripColumn(req.params.lfOid), req.params.lfOid).single();
    if (error) { if (isNotFound(error)) return res.status(404).json({ error: 'Trip not found' }); throw error; }
    const list = (Array.isArray(req.body?.passengers) ? req.body.passengers : []).filter((p) => p.person_id);
    const fields = (p) => ({
      person_id: p.person_id,
      seat: (p.seat || '').trim() || null,
      cargo_lbs: Number.isFinite(Number(p.cargo_lbs)) && p.cargo_lbs !== '' && p.cargo_lbs != null ? Number(p.cargo_lbs) : null,
      tsa_status: (p.tsa_status || '').trim() || null,
      note: (p.note || '').trim() || null,
    });
    // Delete rows the client dropped (keep ids it kept — preserves any attachments).
    const keepIds = list.map((p) => p.id).filter(Boolean);
    let delQ = supabase.from('scheduling_passengers').delete().eq('trip_id', trip.id);
    if (keepIds.length) delQ = delQ.not('id', 'in', `(${keepIds.join(',')})`);
    const { error: de } = await delQ; if (de) throw de;
    for (const p of list.filter((x) => x.id)) {
      const { error: ue } = await supabase.from('scheduling_passengers').update(fields(p)).eq('id', p.id).eq('trip_id', trip.id);
      if (ue) throw ue;
    }
    const inserts = list.filter((x) => !x.id).map((p) => ({ trip_id: trip.id, origin: 'native', ...fields(p) }));
    if (inserts.length) { const { error: ie } = await supabase.from('scheduling_passengers').insert(inserts); if (ie) throw ie; }
    const { data, error: se } = await supabase.from('scheduling_passengers').select(PAX_SELECT).eq('trip_id', trip.id);
    if (se) throw se;
    res.json({ passengers: (data || []).map(shapePax).sort((a, b) => (a.name || '').localeCompare(b.name || '')) });
  } catch (e) {
    console.error('PUT passengers:', e.message);
    res.status(500).json({ error: 'Failed to save passengers' });
  }
});

// DEPRECATED — superseded by GET /people (the manifest picker now searches the
// person directory). Kept for backward-compat; safe to remove once nothing calls it.
// GET /api/scheduling/passengers/suggest — passenger directory for the autocomplete:
// LevelFlight's full customer directory merged with passengers entered here (which
// carry DOB/weight). Deduped by name.
router.get('/passengers/suggest', async (req, res) => {
  try {
    const byName = new Map();
    const put = (name, extra) => {
      const n = (name || '').trim(); if (!n) return;
      const cur = byName.get(n) || { name: n, dob: null, weight_lbs: null, company: null };
      for (const [k, v] of Object.entries(extra)) if (v != null && cur[k] == null) cur[k] = v; // fill, don't clobber
      byName.set(n, cur);
    };

    // LevelFlight customer directory (best-effort; cached in the service).
    try {
      const customers = await lf.getAllCustomers();
      for (const c of customers) put(c.name, { company: c.company });
    } catch (e) { console.warn('[passengers/suggest] LF customers failed:', e?.message || e); }

    // Passengers entered here — fill in DOB/weight where we have them.
    const { data } = await supabase.from('scheduling_passengers').select('name, dob, weight_lbs').not('name', 'is', null);
    for (const p of data || []) put(p.name, { dob: p.dob || null, weight_lbs: p.weight_lbs ?? null });

    res.json({ passengers: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)) });
  } catch (e) {
    res.status(502).json({ error: e.message, passengers: [] });
  }
});

// GET /api/scheduling/airport-search?q=KFX — ranked airport matches for the New Quote
// From/To pickers. Searches only codes the flight-time engine can compute, so every
// suggestion is a quotable airport. Returns [{ code, name, city, region }].
router.get('/airport-search', (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 8, 1), 20);
    res.json({ airports: q ? searchAirports(defaultAirportIndex(), q, limit) : [] });
  } catch (e) {
    console.error('GET /api/scheduling/airport-search:', e.message);
    res.status(500).json({ error: 'Airport search failed', airports: [] });
  }
});

const DOC_BUCKET = 'scheduling-docs';        // private Supabase Storage bucket
const DOC_COLS = 'id, name, doc_type, storage_path, content_type, size_bytes, created_at, passenger_id, person_id';
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
      passenger_id: b.passenger_id || null,
    }).select(DOC_COLS).single();
    if (ie) throw ie;
    res.status(201).json({ document: row });
  } catch (e) {
    console.error('POST documents:', e.message);
    res.status(500).json({ error: 'Failed to upload document' });
  }
});

// POST /api/scheduling/people/:id/documents — upload a person document
// (passport/green card/visa/id). Stored under people/{id}/… and reused on every
// trip. Body: { name, doc_type, content_type, data_base64 }.
router.post('/people/:id/documents', requireSchedulingEditor, express.json({ limit: '25mb' }), async (req, res) => {
  try {
    const { data: person, error } = await supabase.from('scheduling_people').select('id').eq('id', req.params.id).single();
    if (error) { if (isNotFound(error)) return res.status(404).json({ error: 'Person not found' }); throw error; }
    const b = req.body || {};
    const name = safeName(b.name);
    const base64 = (b.data_base64 || '').replace(/^data:[^;]+;base64,/, '');
    if (!base64) return res.status(400).json({ error: 'No file data' });
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length) return res.status(400).json({ error: 'Empty file' });
    const storage_path = `people/${person.id}/${Date.now()}-${name}`;
    const { error: ue } = await supabase.storage.from(DOC_BUCKET)
      .upload(storage_path, buffer, { contentType: b.content_type || 'application/octet-stream', upsert: false });
    if (ue) { if (/bucket/i.test(ue.message)) return res.status(500).json({ error: `Storage bucket "${DOC_BUCKET}" is missing — create it (private) in Supabase.` }); throw ue; }
    const { data: row, error: ie } = await supabase.from('scheduling_documents').insert({
      person_id: person.id, name, doc_type: (b.doc_type || 'passport').trim() || 'passport',
      storage_path, content_type: b.content_type || null, size_bytes: buffer.length, uploaded_by: req.user?.email || null,
    }).select(DOC_COLS).single();
    if (ie) throw ie;
    res.status(201).json({ document: row });
  } catch (e) { console.error('POST person doc:', e.message); res.status(500).json({ error: 'Failed to upload document' }); }
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
