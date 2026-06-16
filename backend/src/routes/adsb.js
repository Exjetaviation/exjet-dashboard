import express from 'express';
import { getLivePositions, getTrails } from '../services/adsb.js';
import { getAirborneSince } from '../services/adsbRecorder.js';
import * as lf from '../services/levelflight.js';
import { queryTrack } from '../services/adsbStore.js';
import { clipTrackToLeg, normReg } from '../services/adsbTrack.js';

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
        legs.push({ id, from: l.departure.airport, to: l.arrival.airport, depTime: dep, arrTime: arr });
      }
    }

    const startIso = new Date(windowStart - PREV_PAD_MS).toISOString();
    const endIso = new Date(now + PREV_PAD_MS).toISOString();
    const positions = await queryTrack(tail, startIso, endIso);

    const flights = legs
      .sort((a, b) => b.depTime - a.depTime)
      .map((leg) => ({
        legId: leg.id, from: leg.from, to: leg.to, depTime: leg.depTime, arrTime: leg.arrTime,
        track: clipTrackToLeg(positions, leg, PREV_PAD_MS),
      }));

    res.json({ tail, days, flights });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'previous-flights failed', flights: [] });
  }
});

// Local helpers (small and route-specific).
function eqTail(leg, tail) {
  const t = leg.dispatch?.aircraft?.tailNumber || leg.aircraft?.tailNumber || '';
  return normReg(t) === tail; // `tail` is already normalized by the caller
}
function monthAnchors(startMs, endMs) {
  const out = []; const d = new Date(startMs);
  let y = d.getUTCFullYear(), m = d.getUTCMonth();
  for (;;) { const t = Date.UTC(y, m, 1); if (t > endMs) break; out.push(t); m++; if (m > 11) { m = 0; y++; } if (out.length > 24) break; }
  out.unshift(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  return out;
}

export default router;
