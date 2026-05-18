import express from 'express';
import { getClassList } from '../services/quickbooks.js';
import { getLevelFlightToken } from '../services/levelflight.js';

const router = express.Router();

router.get('/classes', async (req, res) => {
  try {
    const result = await getClassList();
    res.json({ result, count: result.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.get('/aircraft-calendar', async (req, res) => {
  try {
    const token = await getLevelFlightToken();
    const now = Date.now();
    const twoWeeks = now + (14 * 24 * 60 * 60 * 1000);
    
    const r = await fetch(`${process.env.LEVELFLIGHT_BASE_URL}/api/widgets/aircraftCalendar`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        aircraft: { $oid: '673d145b2c00002200f03411' },
        start: now - (30 * 24 * 60 * 60 * 1000),
        end: twoWeeks,
        includeCancelled: false
      })
    });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
export default router;
