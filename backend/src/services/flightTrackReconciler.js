// backend/src/services/flightTrackReconciler.js
// Periodic job that (1) captures COMPLETED flights into the permanent flight_tracks
// table (the track map) and (2) records each completed leg's ACTUAL dep/arr into
// leg_actuals as a BEST-EFFORT BACKFILL behind the live recorder — exact from the
// stored on_ground transitions when available, else approximate from the first/last
// airborne sample (crowd-sourced ADS-B often misses the on-ground portion). Idempotent:
// skips flight_tracks legs already stored; recordLegActual won't downgrade a live
// reading. The one-time 90-day track backfill is just runReconcile({ days: 90 }).

import * as lf from './levelflight.js';
import { queryTrack } from './adsbStore.js';
import { clipTrackToLeg, deriveActualTimes, approximateActualTimes, monthAnchors, selectCompletedLegs, selectLegsToSnapshot } from './adsbTrack.js';
import { getStoredLegIds, upsertFlightTrack } from './flightTrackStore.js';
import { recordLegActual, getLegIdsWithActuals } from './legActualsStore.js';

const PAD_MS = 10 * 60 * 1000;          // match the previous-flights pad
const HOURLY_MS = 60 * 60 * 1000;
const RECONCILE_LOOKBACK_DAYS = 3;      // steady-state hourly window
let started = false;

// Derive a leg's actuals from a tail's positions (exact transition first, else
// approximate first/last airborne) and record them. recordLegActual's source
// precedence means this never overwrites a live recorder reading. Returns true if
// anything was recorded.
async function deriveAndRecordActuals(positions, leg, tail) {
  const exact = deriveActualTimes(positions, leg, PAD_MS);
  const approx = approximateActualTimes(positions, leg, PAD_MS);
  const actualDep = exact.actualDep ?? approx.actualDep;
  const actualArr = exact.actualArr ?? approx.actualArr;
  if (actualDep == null && actualArr == null) return false;
  await recordLegActual(leg.id, {
    registration: tail,
    scheduledDep: leg.depTime,
    actualDep,
    depSource: exact.actualDep != null ? 'exact' : (approx.actualDep != null ? 'approx' : null),
    actualArr,
    arrSource: exact.actualArr != null ? 'exact' : (approx.actualArr != null ? 'approx' : null),
  });
  return true;
}

// Capture completed flights from the last `days` into flight_tracks, recording actuals
// alongside. Returns a small summary. Safe to re-run (idempotent). Soft-fails as a
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
        // Actuals don't need the 2-point track gate — record from whatever exists.
        await deriveAndRecordActuals(positions, leg, tail);
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

// Bounded actuals backfill for completed legs that have no leg_actuals row yet (e.g.
// flights that completed before this feature, or whose live transition was missed).
// Limited to the firehose retention window — older positions are pruned.
export async function backfillActuals({ days = 13 } = {}) {
  const now = Date.now();
  const windowStart = now - days * 86400000;
  let updated = 0;
  try {
    const anchors = monthAnchors(windowStart, now);
    const results = await Promise.all(anchors.map((ts) => lf.getScheduledLegs(ts).catch(() => ({ legs: [] }))));
    const completed = selectCompletedLegs(results.flatMap((r) => r?.legs || []), now).filter((l) => l.arrTime >= windowStart);
    const have = await getLegIdsWithActuals(completed.map((l) => l.id));
    const todo = completed.filter((l) => l.tail && !have.has(l.id));

    const byTail = new Map();
    for (const leg of todo) {
      if (!byTail.has(leg.tail)) byTail.set(leg.tail, []);
      byTail.get(leg.tail).push(leg);
    }
    for (const [tail, legs] of byTail.entries()) {
      const lo = Math.min(...legs.map((l) => l.depTime)) - PAD_MS;
      const hi = Math.max(...legs.map((l) => l.arrTime)) + PAD_MS;
      const positions = await queryTrack(tail, new Date(lo).toISOString(), new Date(hi).toISOString());
      if (!positions.length) continue;
      for (const leg of legs) { if (await deriveAndRecordActuals(positions, leg, tail)) updated++; }
    }
  } catch (e) {
    console.warn('[flightTrackReconciler] backfillActuals error (soft):', e?.message || e);
  }
  console.log(`[flightTrackReconciler] actuals backfill days=${days} updated=${updated}`);
  return { updated };
}

export function startReconciler() {
  if (started) return;
  started = true;
  // One-time track backfill on boot (idempotent), then a short-lookback hourly pass.
  runReconcile({ days: 90 }).catch(() => {});
  // Fill actuals for legs that completed before this feature (firehose window only).
  backfillActuals({ days: 13 }).catch(() => {});
  setInterval(() => { runReconcile({ days: RECONCILE_LOOKBACK_DAYS }).catch(() => {}); }, HOURLY_MS);
  console.log('[flightTrackReconciler] started (90d backfill on boot, hourly', RECONCILE_LOOKBACK_DAYS, 'day pass)');
}
