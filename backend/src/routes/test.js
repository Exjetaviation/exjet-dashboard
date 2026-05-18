import express from 'express';
import axios from 'axios';
import { getClassList } from '../services/quickbooks.js';

const router = express.Router();

router.get('/aircraft-calendar', async (req, res) => {
  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('client_id', process.env.LEVELFLIGHT_CLIENT_ID);
    params.append('refresh_token', process.env.LEVELFLIGHT_REFRESH_TOKEN);
    const tokenRes = await axios.post(process.env.LEVELFLIGHT_TOKEN_URL, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const token = tokenRes.data.id_token;
    const now = Date.now();
    const r = await axios.post(`${process.env.LEVELFLIGHT_BASE_URL}/api/widgets/aircraftCalendar`, {
      aircraft: { $oid: '673d145b2c00002200f03411' },
      start: now - (30 * 24 * 60 * 60 * 1000),
      end: now + (14 * 24 * 60 * 60 * 1000),
      includeCancelled: false
    }, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' }
    });
    res.json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

router.get('/classes', async (req, res) => {
  try {
    const result = await getClassList();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
router.get('/pilot-calendar', async (req, res) => {
  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('client_id', process.env.LEVELFLIGHT_CLIENT_ID);
    params.append('refresh_token', process.env.LEVELFLIGHT_REFRESH_TOKEN);
    const tokenRes = await axios.post(process.env.LEVELFLIGHT_TOKEN_URL, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const token = tokenRes.data.id_token;
    const now = Date.now();
    const r = await axios.post(`${process.env.LEVELFLIGHT_BASE_URL}/api/widgets/pilotCalendar`, {
      start: now,
      end: now + (30 * 24 * 60 * 60 * 1000),
    }, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    res.json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

export default router;
