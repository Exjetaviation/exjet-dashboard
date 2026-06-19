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
import { priceQuoteLegs } from '../scheduling/priceQuote.js';

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
    const legRows = inputLegs.map((l, i) => {
      const leg = {
        seq: i,
        dep_icao: (l.dep_icao || '').trim().toUpperCase() || null,
        arr_icao: (l.arr_icao || '').trim().toUpperCase() || null,
        dep_time: l.dep_time || null,
        arr_time: l.arr_time || null,
      };
      // pax/positioning live only in the snapshot (no such leg columns), so re-price
      // can read them back faithfully.
      const snap = buildNativeLegSnapshot({ ...leg, pax: Number(l.pax) || 0, positioning: !!l.positioning }, ctx);
      return { trip_id: trip.id, origin: 'native', ...leg, lf_synced_snapshot: snap };
    });
    const { error: e2 } = await supabase.from('scheduling_legs').insert(legRows);
    if (e2) throw e2;

    // Price the new quote (best-effort — never fail creation). Pax/positioning come
    // from the submitted legs when present (default 0/false).
    try {
      const pricing = await priceQuoteLegs({
        tail: aircraft_tail, aircraftType: null,
        legs: legRows.map((r, i) => ({ dep_icao: r.dep_icao, arr_icao: r.arr_icao, pax: Number(inputLegs[i]?.pax) || 0, isPositioning: !!inputLegs[i]?.positioning })),
        nights: 0,
      });
      await supabase.from('scheduling_trips').update({ pricing, rate_name: pricing.rateName || null }).eq('id', trip.id);
    } catch (pe) { console.warn('[scheduling price-on-create] failed:', pe?.message || pe); }

    res.status(201).json({ id: trip.id, trip: shapeTrip(trip) });
  } catch (e) {
    console.error('POST /api/scheduling/trips:', e.message);
    res.status(500).json({ error: 'Failed to create trip' });
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
