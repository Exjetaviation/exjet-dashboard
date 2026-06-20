// backend/src/services/flightTrackReconciler.js
// Periodic job that captures COMPLETED flights into the permanent flight_tracks
// table. Reuses the LevelFlight leg fetch + ADS-B clip logic from the
// previous-flights route. Idempotent: skips legs already stored. The one-time
// 90-day backfill is just runReconcile({ days: 90 }).

import * as lf from './levelflight.js';
import { queryTrack } from './adsbStore.js';
import { clipTrackToLeg, monthAnchors, selectCompletedLegs, selectLegsToSnapshot } from './adsbTrack.js';
import { getStoredLegIds, upsertFlightTrack } from './flightTrackStore.js';

const PAD_MS = 10 * 60 * 1000;          // match the previous-flights pad
const HOURLY_MS = 60 * 60 * 1000;
const RECONCILE_LOOKBACK_DAYS = 3;      // steady-state hourly window
let started = false;

// Capture completed flights from the last `days` into flight_tracks. Returns a
// small summary. Safe to re-run (idempotent via stored-id skip). Soft-fails as a
// whole — never throws.
export async function runReconcile({ days = RECONCILE_LOOKBACK_DAYS } = {}) {
  const now = Date.now();
  const windowStart = now - days * 86400000;
  let scanned = 0, written = 0, skipped = 0;
  try {
    const anchors = monthAnchors(windowStart, now);
    const results = await Promise.all(anchors.map((ts) => lf.getScheduledLegs(ts).catch(() => ({ legs: [] }))));
    const allLegs = results.flatMap((r) => r?.legs || []);
    const completed = selectCompletedLegs(allLegs, now).filter((l) => l.arrTime >= windowStart);
    scanned = completed.length;

    const existing = await getStoredLegIds(completed.map((l) => l.id));
    const todo = selectLegsToSnapshot(completed, existing);
    skipped = scanned - todo.length;

    // Group by tail so we query each aircraft's positions once.
    const byTail = new Map();
    for (const leg of todo) {
      if (!leg.tail) continue;
      if (!byTail.has(leg.tail)) byTail.set(leg.tail, []);
      byTail.get(leg.tail).push(leg);
    }
    for (const [tail, legs] of byTail.entries()) {
      const lo = Math.min(...legs.map((l) => l.depTime)) - PAD_MS;
      const hi = Math.max(...legs.map((l) => l.arrTime)) + PAD_MS;
      const positions = await queryTrack(tail, new Date(lo).toISOString(), new Date(hi).toISOString());
      for (const leg of legs) {
        const track = clipTrackToLeg(positions, leg, PAD_MS);
        // Don't store an empty snapshot — it would be marked "stored" and never
        // retried, locking the flight out even if positions land later. Skipping
        // leaves it to be re-attempted on the next pass within its window.
        if (track.length < 2) { skipped++; continue; }
        const ok = await upsertFlightTrack({
          leg_id: leg.id,
          registration: tail,
          from_airport: leg.from,
          to_airport: leg.to,
          dep_time: new Date(leg.depTime).toISOString(),
          arr_time: new Date(leg.arrTime).toISOString(),
          track,
          point_count: track.length,
        });
        if (ok) written++;
      }
    }
  } catch (e) {
    console.warn('[flightTrackReconciler] runReconcile error (soft):', e?.message || e);
  }
  console.log(`[flightTrackReconciler] reconcile days=${days} scanned=${scanned} written=${written} skipped=${skipped}`);
  return { scanned, written, skipped };
}

export function startReconciler() {
  if (started) return;
  started = true;
  // One-time backfill on boot (idempotent), then a short-lookback hourly pass.
  runReconcile({ days: 90 }).catch(() => {});
  setInterval(() => { runReconcile({ days: RECONCILE_LOOKBACK_DAYS }).catch(() => {}); }, HOURLY_MS);
  console.log('[flightTrackReconciler] started (90d backfill on boot, hourly', RECONCILE_LOOKBACK_DAYS, 'day pass)');
}
