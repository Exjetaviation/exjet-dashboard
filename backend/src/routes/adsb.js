import express from 'express';
import { getLivePositions, getTrails, getFleet } from '../services/adsb.js';
import { getAirborneSince } from '../services/adsbRecorder.js';
import * as lf from '../services/levelflight.js';
import { queryTrack, queryRecentTrails, getLastPositions } from '../services/adsbStore.js';
import { clipTrackToLeg, normReg, monthAnchors, legTail } from '../services/adsbTrack.js';
import { getFlightTrack, getFlightTracksByLegIds } from '../services/flightTrackStore.js';
import { getLegActualsInRange, recordDivert } from '../services/legActualsStore.js';
import { canEditScheduling } from '../scheduling/canEdit.js';

const router = express.Router();

router.get('/positions', async (req, res) => {
  try {
    const positions = await getLivePositions();
    const airborne = getAirborneSince();
    const merged = {};
    for (const [reg, p] of Object.entries(positions)) {
      merged[reg] = { ...p, airborneSinceMs: airborne[reg] ?? null };
    }
    // Fleet tails with NO current live fix: surface their last-known firehose fix
    // (flagged stale) so the map shows where the plane actually last was rather than
    // snapping to its scheduled arrival. Soft — skips silently if the store is absent.
    try {
      const missing = getFleet().filter((reg) => !merged[reg]);
      if (missing.length) {
        const last = await getLastPositions(missing);
        for (const [reg, p] of Object.entries(last)) {
          merged[reg] = { lat: p.lat, lon: p.lon, onGround: p.on_ground, stale: true, lastSeenMs: p.t, airborneSinceMs: null };
        }
      }
    } catch { /* soft */ }
    res.json({ positions: merged });
  } catch (e) {
    res.status(502).json({ error: e.message, positions: {} });
  }
});

// Flight trails from the PERSISTED firehose (survives restarts, fuller than the in-memory
// trail). Falls back to the in-memory trail if Supabase is off / returns nothing.
router.get('/trail', async (req, res) => {
  try {
    const sinceIso = new Date(Date.now() - 12 * 3600000).toISOString();
    const trails = await queryRecentTrails(sinceIso);
    res.json({ trails: Object.keys(trails).length ? trails : getTrails() });
  } catch (e) {
    res.json({ trails: getTrails() });
  }
});

// GET /api/adsb/actuals?from=<ms>&to=<ms> — actual departure/arrival (epoch ms, or null)
// by leg id, for legs whose SCHEDULED departure falls in the range, with per-field
// source ('live' | 'exact' | 'approx'). Backs the calendar's scheduled-vs-actual delay
// overlay (the calendar can flag 'approx' visually). Soft-fails to { actuals: {} }.
router.get('/actuals', async (req, res) => {
  try {
    const now = Date.now();
    const to = Number(req.query.to) || now;
    let from = Number(req.query.from) || (to - 31 * 86400000); // default ~1 month back
    if (to - from > 400 * 86400000) from = to - 400 * 86400000; // clamp absurd spans
    const rows = await getLegActualsInRange(new Date(from).toISOString(), new Date(to).toISOString());
    const actuals = {};
    for (const r of rows) {
      actuals[r.leg_id] = {
        actualDep: r.actual_dep_time ? Date.parse(r.actual_dep_time) : null,
        actualArr: r.actual_arr_time ? Date.parse(r.actual_arr_time) : null,
        depSource: r.dep_source || null,
        arrSource: r.arr_source || null,
        // Diversion mark (migration 023; undefined pre-migration → null).
        divertedTo: r.actual_arr_icao || null,
        divertNote: r.divert_note || null,
        divertStatus: r.divert_status || null,
      };
    }
    res.json({ actuals });
  } catch (e) {
    res.status(200).json({ actuals: {}, error: e.message });
  }
});

// POST /api/adsb/legs/:legId/divert — dispatcher marks a leg as diverted to a different
// airport (incomplete flight). Body: { divertedToIcao, note?, status?, actualArr? (ms),
// scheduledDep? (ms), registration? }. Editor-gated. Needs migration 023.
router.post('/legs/:legId/divert', async (req, res) => {
  try {
    if (!canEditScheduling(req.user?.role)) return res.status(403).json({ error: 'forbidden' });
    const { legId } = req.params;
    const { divertedToIcao, note, status, actualArr, scheduledDep, registration } = req.body || {};
    if (!legId || !divertedToIcao) return res.status(400).json({ error: 'legId and divertedToIcao are required' });
    const ok = await recordDivert(legId, {
      divertedToIcao: String(divertedToIcao).toUpperCase().replace(/[^A-Z0-9]/g, ''),
      note: note ?? null, status: status ?? 'diverted',
      actualArr: actualArr != null ? Number(actualArr) : null,
      scheduledDep: scheduledDep != null ? Number(scheduledDep) : null,
      registration: registration ?? null,
    });
    if (!ok) return res.status(500).json({ error: 'could not record divert (is migration 023 applied?)' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PREV_PAD_MS = 10 * 60 * 1000; // 10-minute pad around each leg window

// GET /api/adsb/previous-flights?tail=N69FP&days=3
// Completed legs for `tail` in the last `days`, each with its real ADS-B track
// (persisted positions clipped to the leg window). Soft: returns [] on any miss.
router.get('/previous-flights', async (req, res) => {
  const tail = normReg(typeof req.query.tail === 'string' ? req.query.tail : '');
  const days = Math.max(1, Math.min(365, parseInt(req.query.days || '30', 10) || 30));
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

    // Permanent snapshots (any age) back the long-range history; the raw firehose
    // (pruned at 14 days) is only a fallback for very recent legs not yet snapshotted.
    const permanent = await getFlightTracksByLegIds(legs.map((l) => l.id));
    const rawStart = new Date(Math.max(windowStart, now - 14 * 86400000) - PREV_PAD_MS).toISOString();
    const endIso = new Date(now + PREV_PAD_MS).toISOString();
    const positions = await queryTrack(tail, rawStart, endIso);

    const flights = legs
      .sort((a, b) => b.depTime - a.depTime)
      .map((leg) => {
        const snap = permanent.get(leg.id);
        const track = snap?.track && snap.track.length >= 2 ? snap.track : clipTrackToLeg(positions, leg, PREV_PAD_MS);
        return { legId: leg.id, from: leg.from, to: leg.to, depTime: leg.depTime, arrTime: leg.arrTime, tripId: leg.tripId, track };
      });

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
