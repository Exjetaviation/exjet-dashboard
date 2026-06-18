// backend/src/routes/scheduling.js
import express from 'express';
import { supabase } from '../services/supabase.js';
import { formatSyncStatus } from '../scheduling/formatSyncStatus.js';
import { mirrorLegsFromRows } from '../scheduling/mirrorLegs.js';

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

export default router;
