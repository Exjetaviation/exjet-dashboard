// backend/src/routes/scheduling.js
import express from 'express';
import { supabase } from '../services/supabase.js';
import { formatSyncStatus } from '../scheduling/formatSyncStatus.js';
import { mirrorLegsFromRows } from '../scheduling/mirrorLegs.js';
import { dispatchStatusLabel, isEditableStatus } from '../scheduling/dispatchStatus.js';
import { tripColumnsFromSnapshot } from '../scheduling/tripFromSnapshot.js';

const router = express.Router();

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

const TRIP_COLS = 'lf_oid, trip_number, status, locally_modified, upstream_changed, lf_synced_snapshot';

// Shape a scheduling_trips row for the API (adds labels + the LF-original status).
function shapeTrip(row) {
  const orig = row.lf_synced_snapshot?.status ?? null;
  return {
    lf_oid: row.lf_oid,
    trip_number: row.trip_number,
    status: row.status,
    status_label: dispatchStatusLabel(row.status),
    original_status: orig,
    original_status_label: dispatchStatusLabel(orig),
    locally_modified: row.locally_modified,
    upstream_changed: row.upstream_changed,
  };
}

// GET /api/scheduling/trips/:lfOid — one trip's status + provenance.
router.get('/trips/:lfOid', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('scheduling_trips').select(TRIP_COLS).eq('lf_oid', req.params.lfOid).single();
    if (error) throw error;
    res.json({ trip: shapeTrip(data) });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// PATCH /api/scheduling/trips/:lfOid — local-override the status (never touches LevelFlight).
router.patch('/trips/:lfOid', async (req, res) => {
  try {
    const status = req.body?.status;
    if (!isEditableStatus(status)) return res.status(400).json({ error: 'invalid status' });
    const { data, error } = await supabase
      .from('scheduling_trips')
      .update({ status, locally_modified: true, modified_at: new Date().toISOString(), modified_by: req.user?.email || null })
      .eq('lf_oid', req.params.lfOid)
      .select(TRIP_COLS).single();
    if (error) throw error;
    res.json({ trip: shapeTrip(data) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// POST /api/scheduling/trips/:lfOid/revert — restore the working copy from the LF snapshot.
router.post('/trips/:lfOid/revert', async (req, res) => {
  try {
    const { data: cur, error: e1 } = await supabase
      .from('scheduling_trips').select('lf_synced_snapshot').eq('lf_oid', req.params.lfOid).single();
    if (e1) throw e1;
    const cols = tripColumnsFromSnapshot(cur.lf_synced_snapshot);
    const { data, error } = await supabase
      .from('scheduling_trips')
      .update({ ...cols, locally_modified: false, upstream_changed: false, modified_by: null, modified_at: new Date().toISOString() })
      .eq('lf_oid', req.params.lfOid)
      .select(TRIP_COLS).single();
    if (error) throw error;
    res.json({ trip: shapeTrip(data) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

export default router;
