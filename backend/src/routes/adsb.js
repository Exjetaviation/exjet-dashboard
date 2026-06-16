import express from 'express';
import { getLivePositions, getTrails } from '../services/adsb.js';
import { getAirborneSince } from '../services/adsbRecorder.js';

const router = express.Router();

router.get('/positions', async (req, res) => {
  try {
    const positions = await getLivePositions();
    const airborne = getAirborneSince();
    const merged = {};
    for (const [reg, p] of Object.entries(positions)) {
      merged[reg] = { ...p, airborneSinceMs: airborne[reg] ?? null };
    }
    res.json({ positions: merged });
  } catch (e) {
    res.status(502).json({ error: e.message, positions: {} });
  }
});

router.get('/trail', (req, res) => res.json({ trails: getTrails() }));

export default router;
