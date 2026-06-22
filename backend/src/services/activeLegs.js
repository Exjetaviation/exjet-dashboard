// backend/src/services/activeLegs.js
// A short-lived cache of each tail's scheduled legs around "now", so the ADS-B
// recorder can attribute a live takeoff/landing to the right leg (the server-side
// counterpart of the calendar's airborne-leg match). Soft-fails to an empty map.

import * as lf from './levelflight.js';
import { legTail, monthAnchors } from './adsbTrack.js';

const TTL_MS = 5 * 60 * 1000;
let cache = new Map(); // normalized tail -> [{ legId, depTime, arrTime }]
let cachedAt = 0;

// Map(tail -> legs[]) for legs near now (this month + the prior month, to cover
// month boundaries and in-progress flights). Cached for TTL_MS.
export async function getActiveLegsByTail(nowMs = Date.now()) {
  if (cache.size && nowMs - cachedAt < TTL_MS) return cache;
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
  return cache;
}
