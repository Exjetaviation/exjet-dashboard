import express from 'express';
import { getLivePositions, getTrails } from '../services/adsb.js';

const router = express.Router();

router.get('/positions', async (req, res) => {
  try {
    res.json({ positions: await getLivePositions() });
  } catch (e) {
    res.status(502).json({ error: e.message, positions: {} });
  }
});

router.get('/trail', (req, res) => res.json({ trails: getTrails() }));

export default router;
