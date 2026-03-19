import express from 'express';
import * as lf from '../services/levelflight.js';

const router = express.Router();

router.get('/aircraft', async (req, res) => {
  try {
    const data = await lf.getAircraft();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/pilots', async (req, res) => {
  try {
    const data = await lf.getPilots(req.query.page || 1);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/legs', async (req, res) => {
  try {
    const start = req.query.start || Date.now();
    const data = await lf.getScheduledLegs(parseInt(start));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/duty', async (req, res) => {
  try {
    const start = req.query.start || Date.now();
    const data = await lf.getDutyTimes(parseInt(start));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/aircraft-status/:oid', async (req, res) => {
  try {
    const data = await lf.getAircraftStatus(req.params.oid);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/trip/:oid', async (req, res) => {
  try {
    const data = await lf.getTripLog(req.params.oid);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
