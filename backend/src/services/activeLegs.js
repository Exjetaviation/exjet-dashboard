// backend/src/services/activeLegs.js
// A short-lived cache of each tail's scheduled legs around "now", so the ADS-B
// recorder can attribute a live takeoff/landing to the right leg (the server-side
// counterpart of the calendar's airborne-leg match). Soft-fails to an empty map.

import * as lf from './levelflight.js';
import { legTail, monthAnchors } from './adsbTrack.js';
import { getActualsByLeg } from './legActualsStore.js';

const TTL_MS = 5 * 60 * 1000;
let cache = new Map(); // normalized tail -> [{ legId, depTime, arrTime }] (scheduled, from LF)
let cachedAt = 0;

// Map(tail -> legs[]) for legs near now (this month + the prior month, to cover
// month boundaries and in-progress flights). The expensive LevelFlight schedule is
// cached for TTL_MS; each leg is then enriched with its current ACTUAL arrival
// (cheap, fresh every call) so matchActiveLeg can skip legs that have already
// landed — including a rapid turnaround that lands and re-departs within the cache
// window. Returns a fresh Map of cloned legs (the schedule cache stays pristine).
export async function getActiveLegsByTail(nowMs = Date.now()) {
  if (!(cache.size && nowMs - cachedAt < TTL_MS)) {
    try {
      const anchors = monthAnchors(nowMs - 2 * 86400000, nowMs); // prior + current month
      const results = await Promise.all(anchors.map((ts) => lf.getScheduledLegs(ts).catch(() => ({ legs: [] }))));
      const legs = results.flatMap((r) => r?.legs || []);
      const map = new Map();
      const seen = new Set();
      for (const l of legs) {
        const legId = l?._id?.$oid;
        const tail = legTail(l);
        const depTime = l?.departure?.time;
        const arrTime = l?.arrival?.time;
        if (!legId || !tail || depTime == null || arrTime == null || seen.has(legId)) continue;
        seen.add(legId);
        if (!map.has(tail)) map.set(tail, []);
        map.get(tail).push({ legId, depTime, arrTime });
      }
      cache = map;
      cachedAt = nowMs;
    } catch (e) {
      console.warn('[activeLegs] refresh failed (soft):', e?.message || e);
    }
  }

  // Clone + enrich with fresh actual dep/arr so a truly-completed leg (coherent
  // dep+arr) drops out of the active match — and a leg carrying only a corrupt
  // arrival does NOT. Soft-fails to nulls (matcher falls back to earliest-in-window).
  const out = new Map();
  const allIds = [];
  for (const [tail, legs] of cache) { out.set(tail, legs.map((l) => ({ ...l, actualDep: null, actualArr: null }))); for (const l of legs) allIds.push(l.legId); }
  try {
    const actualsByLeg = await getActualsByLeg(allIds);
    for (const legs of out.values()) for (const l of legs) {
      const a = actualsByLeg.get(l.legId);
      if (a) { l.actualDep = a.dep ?? null; l.actualArr = a.arr ?? null; }
    }
  } catch (e) {
    console.warn('[activeLegs] actuals enrich failed (soft):', e?.message || e);
  }
  return out;
}
