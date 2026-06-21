import express from 'express';
import * as lf from '../services/levelflight.js';
import { assignedPaxCount } from '../services/paxCount.js';

const router = express.Router();

const getMonthTimestamps = (monthsBack = 2, monthsForward = 12) => {
  const timestamps = [];
  const now = new Date();
  for (let i = monthsBack; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    timestamps.push(d.getTime());
  }
  for (let i = 1; i <= monthsForward; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
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
    const timestamps = getMonthTimestamps(2, 3);
    const results = await Promise.all(
      timestamps.map(ts => lf.getScheduledLegs(ts).catch(() => ({ legs: [] })))
    );
    const allLegs = results.flatMap(r => r.legs || []);
    // Report ASSIGNED passengers (the `passengers` list), not LF's passengerCount
    // field, so Flights/Calendar/FlightDetail show the right count.
    const legs = dedupeLegs(allLegs).sort((a, b) => (b.departure?.time || 0) - (a.departure?.time || 0))
      .map((l) => ({ ...l, passengerCount: assignedPaxCount(l) }));
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
router.get('/pilot-calendar', async (req, res) => {
  try {
    const now = Date.now();
    const data = await lf.getPilotCalendar(now, now + (30 * 24 * 60 * 60 * 1000));
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
export default router;

