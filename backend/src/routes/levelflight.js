import express from 'express';
import * as lf from '../services/levelflight.js';

const router = express.Router();

const getMonthTimestamps = (monthsBack = 6) => {
  const timestamps = [];
  const now = new Date();
  for (let i = 0; i <= monthsBack; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    timestamps.push(d.getTime());
  }
  return timestamps;
};

const dedupeLegs = (legs) => {
  const seen = new Set();
  return legs.filter(leg => {
    const id = leg._id?.$oid;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

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
    const monthsBack = parseInt(req.query.months || '6');
    const timestamps = getMonthTimestamps(monthsBack);
    const results = await Promise.all(
      timestamps.map(ts => lf.getScheduledLegs(ts).catch(() => ({ legs: [] })))
    );
    const allLegs = results.flatMap(r => r.legs || []);
    const legs = dedupeLegs(allLegs).sort((a, b) => (b.departure?.time || 0) - (a.departure?.time || 0));
    res.json({ success: true, legs, months: monthsBack + 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/duty', async (req, res) => {
  try {
    const monthsBack = parseInt(req.query.months || '6');
    const timestamps = getMonthTimestamps(monthsBack);
    const results = await Promise.all(
      timestamps.map(ts => lf.getDutyTimes(ts).catch(() => ({ dutyTimes: [] })))
    );
    const allDuty = results.flatMap(r => r.dutyTimes || []);
    const seen = new Set();
    const dutyTimes = allDuty.filter(d => {
      const id = d._id?.$oid;
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    res.json({ success: true, dutyTimes });
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
