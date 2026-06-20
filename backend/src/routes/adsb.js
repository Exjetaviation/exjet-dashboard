import express from 'express';
import { getLivePositions, getTrails } from '../services/adsb.js';
import { getAirborneSince } from '../services/adsbRecorder.js';
import * as lf from '../services/levelflight.js';
import { queryTrack } from '../services/adsbStore.js';
import { clipTrackToLeg, normReg, monthAnchors, legTail } from '../services/adsbTrack.js';
import { getFlightTrack } from '../services/flightTrackStore.js';

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

const PREV_PAD_MS = 10 * 60 * 1000; // 10-minute pad around each leg window

// GET /api/adsb/previous-flights?tail=N69FP&days=3
// Completed legs for `tail` in the last `days`, each with its real ADS-B track
// (persisted positions clipped to the leg window). Soft: returns [] on any miss.
router.get('/previous-flights', async (req, res) => {
  const tail = normReg(typeof req.query.tail === 'string' ? req.query.tail : '');
  const days = Math.max(1, Math.min(14, parseInt(req.query.days || '3', 10) || 3));
  if (!tail) return res.status(400).json({ error: 'tail is required', flights: [] });

  const now = Date.now();
  const windowStart = now - days * 86400000;

  try {
    const anchors = monthAnchors(windowStart, now);
    const results = await Promise.all(anchors.map((ts) => lf.getScheduledLegs(ts).catch(() => ({ legs: [] }))));
    const seen = new Set();
    const legs = [];
    for (const r of results) for (const l of (r?.legs || [])) {
      const id = l._id?.$oid; if (!id || seen.has(id)) continue; seen.add(id);
      const dep = l.departure?.time, arr = l.arrival?.time;
      if (!dep || !arr) continue;
      if (eqTail(l, tail) && arr <= now && arr >= windowStart) {
        legs.push({ id, from: l.departure.airport, to: l.arrival.airport, depTime: dep, arrTime: arr, tripId: l.dispatch?.tripId ?? null });
      }
    }

    const startIso = new Date(windowStart - PREV_PAD_MS).toISOString();
    const endIso = new Date(now + PREV_PAD_MS).toISOString();
    const positions = await queryTrack(tail, startIso, endIso);

    const flights = legs
      .sort((a, b) => b.depTime - a.depTime)
      .map((leg) => ({
        legId: leg.id, from: leg.from, to: leg.to, depTime: leg.depTime, arrTime: leg.arrTime, tripId: leg.tripId,
        track: clipTrackToLeg(positions, leg, PREV_PAD_MS),
      }));

    res.json({ tail, days, flights });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'previous-flights failed', flights: [] });
  }
});

// Local helpers (small and route-specific).
function eqTail(leg, tail) {
  return legTail(leg) === tail; // `tail` is already normalized by the caller
}

// GET /api/adsb/flight-track/:legId?tail=N69FP&dep=<ms>&arr=<ms>
// Permanent snapshot for one completed flight. If none exists yet (in-progress /
// not-yet-reconciled), falls back to a live clip of raw positions when tail+dep
// are supplied. Soft: returns an empty track on any miss.
router.get('/flight-track/:legId', async (req, res) => {
  const legId = req.params.legId;
  try {
    const snap = await getFlightTrack(legId);
    if (snap) {
      return res.json({
        legId,
        source: 'snapshot',
        from: snap.from_airport,
        to: snap.to_airport,
        depTime: Date.parse(snap.dep_time) || null,
        arrTime: Date.parse(snap.arr_time) || null,
        track: snap.track || [],
      });
    }

    const tail = normReg(typeof req.query.tail === 'string' ? req.query.tail : '');
    const dep = parseInt(req.query.dep, 10);
    if (tail && Number.isFinite(dep)) {
      const now = Date.now();
      const arr = parseInt(req.query.arr, 10);
      const arrTime = Number.isFinite(arr) ? arr : now;
      const startIso = new Date(dep - PREV_PAD_MS).toISOString();
      const endIso = new Date(arrTime + PREV_PAD_MS).toISOString();
      const positions = await queryTrack(tail, startIso, endIso);
      const track = clipTrackToLeg(positions, { depTime: dep, arrTime }, PREV_PAD_MS);
      return res.json({ legId, source: 'live', from: null, to: null, depTime: dep, arrTime, track });
    }

    return res.json({ legId, source: 'none', track: [] });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'flight-track failed', track: [] });
  }
});

export default router;
