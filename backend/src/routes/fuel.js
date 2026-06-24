import express from 'express';
import { scanFuelMail } from '../services/fuel/fuelMailScan.js';
import { getFuelPrices, getImports } from '../services/fuel/fuelStore.js';
import { canEditScheduling } from '../scheduling/canEdit.js';

const router = express.Router();
const requireEditor = (req, res, next) =>
  canEditScheduling(req.user?.role) ? next() : res.status(403).json({ error: 'requires a dispatcher / scheduler role' });

// POST /api/fuel/scan — run the mailbox scan on demand (setup/verification).
router.post('/scan', requireEditor, async (req, res) => {
  try { res.json(await scanFuelMail()); }
  catch (e) { console.error('POST /api/fuel/scan:', e.message); res.status(500).json({ error: 'scan failed' }); }
});

// GET /api/fuel/prices?icao=&vendor= — read stored prices.
router.get('/prices', async (req, res) => {
  res.json({ prices: await getFuelPrices({ icao: req.query.icao, vendor: req.query.vendor }) });
});

// GET /api/fuel/imports — recent import log (freshness/health).
router.get('/imports', async (req, res) => {
  res.json({ imports: await getImports() });
});

export default router;
