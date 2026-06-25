// backend/src/routes/fleet.js
import { Router } from 'express';
import { supabase } from '../services/supabase.js';
import { canEditScheduling } from '../scheduling/canEdit.js';
import { listAircraft, getAircraft, patchAircraft, upsertAircraftByTail } from '../fleet/aircraftStore.js';
import { listComponents, upsertComponent, applyLedgerEntry, recomputeTotals } from '../fleet/componentStore.js';
import { importFleet } from '../fleet/lfAircraftImport.js';
import * as lf from '../services/levelflight.js';

const router = Router();

function requireEditor(req, res, next) {
  if (!canEditScheduling(req.user?.role)) return res.status(403).json({ error: 'forbidden' });
  next();
}

router.get('/aircraft', async (_req, res) => res.json(await listAircraft(supabase)));

router.get('/aircraft/:idOrTail', async (req, res) => {
  const ac = await getAircraft(supabase, req.params.idOrTail);
  if (!ac) return res.status(404).json({ error: 'not found' });
  const components = await listComponents(supabase, ac.id);
  res.json({ ...ac, components });
});

router.patch('/aircraft/:id', requireEditor, async (req, res) =>
  res.json(await patchAircraft(supabase, req.params.id, req.body || {})));

router.post('/aircraft/import', requireEditor, async (_req, res) => {
  const result = await importFleet({
    fetchList: lf.getAircraftList, fetchDetail: lf.getAircraftDetail, fetchTimes: lf.getOtherFlightTimes,
    getExistingByTail: (tail) => getAircraft(supabase, tail),
    upsertAircraft: (row) => upsertAircraftByTail(supabase, row),
    upsertComponent: (row) => upsertComponent(supabase, row),
  });
  res.json(result);
});

router.get('/components', async (_req, res) => res.json(await listComponents(supabase)));
router.post('/aircraft/:id/components', requireEditor, async (req, res) =>
  res.json(await upsertComponent(supabase, { ...req.body, aircraft_id: req.params.id })));
router.get('/components/:id/ledger', async (req, res) => {
  if (!supabase) return res.json([]);
  const { data } = await supabase.from('component_time_entries').select('*').eq('component_id', req.params.id).order('created_at', { ascending: false });
  res.json(data || []);
});
router.post('/components/:id/entries', requireEditor, async (req, res) => {
  const entry = { component_id: req.params.id, source: req.body.source || 'manual',
    hours_delta: Number(req.body.hours_delta || 0), cycles_delta: Number(req.body.cycles_delta || 0),
    note: req.body.note || null, created_by: req.user?.email || null };
  await applyLedgerEntry(supabase, entry);
  res.json(await recomputeTotals(supabase, req.params.id));
});

export default router;
