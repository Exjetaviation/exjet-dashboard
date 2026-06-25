// backend/src/services/adsbRecorder.js
// Always-on background poller. Starts with the server and records fleet ADS-B
// positions every RECORD_INTERVAL_MS regardless of whether any client is
// connected, so flight tracks accumulate continuously. Maintains in-memory
// airborneSince per aircraft for the "time flying" timer, and prunes old rows.

import { getLivePositions } from './adsb.js';
import { savePositions, pruneOld, queryTrack } from './adsbStore.js';
import { hasMoved, detectTakeoff, recoverDepFromPositions, normReg, matchActiveLeg } from './adsbTrack.js';
import { getActiveLegsByTail } from './activeLegs.js';
import { recordLegActual } from './legActualsStore.js';

// getLivePositions() caches for ~20s, so polling faster just re-reads the same
// snapshot — match the cache TTL so each tick gets a fresh fix.
const RECORD_INTERVAL_MS = 20000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000; // hourly
const RETENTION_DAYS = 14; // raw firehose only; permanent history lives in flight_tracks
const MOVE_THRESHOLD_DEG = 0.0005;
const HISTORY_PAD_MS = 10 * 60 * 1000;       // firehose lookback pad (matches the reconciler)
const MAX_DEP_LATENESS_MS = 2 * 3600000;     // last-resort "now" dep only this close to schedule

// Recover a leg's REAL departure from the persisted firehose, for when we first see the tail
// already airborne with no real-time takeoff (the server booted mid-flight, or ADS-B picked the
// plane up mid-climb). Returns { dep, source } labeled by how it was derived — 'exact' for a
// stored ground->air transition, 'approx' for the earliest airborne sample — NOT 'live', so the
// hourly reconciler (and crew OOOI) can still refine it. Never "now" (which would read 30+ min
// late after a restart). { dep: null } if there's no usable history. Soft-fails.
async function recoverDepFromHistory(tail, leg) {
  try {
    const lo = leg.depTime - HISTORY_PAD_MS;
    const hi = leg.arrTime + HISTORY_PAD_MS;
    const positions = await queryTrack(tail, new Date(lo).toISOString(), new Date(hi).toISOString());
    return recoverDepFromPositions(positions, leg, HISTORY_PAD_MS);
  } catch (e) { console.warn('[adsbRecorder] dep history recover failed (soft):', e?.message || e); return { dep: null, source: null }; }
}

// reg -> { lat, lon, onGround, airborneSince }
const last = new Map();
let started = false;

export function getAirborneSince() {
  const out = {};
  for (const [reg, s] of last.entries()) out[reg] = s.airborneSince ?? null;
  return out;
}

async function tick() {
  let positions;
  try { positions = await getLivePositions(); }
  catch (e) { console.warn('[adsbRecorder] positions fetch failed:', e?.message || e); return; }

  const now = Date.now();
  const activeLegs = await getActiveLegsByTail(now); // cached ~5min; soft-fails to empty
  const rows = [];
  for (const [reg, p] of Object.entries(positions || {})) {
    if (p?.lat == null || p?.lon == null) continue;
    const prev = last.get(reg) || null;
    const onGround = !!p.onGround;
    const tail = normReg(reg);
    const leg = matchActiveLeg(activeLegs.get(tail) || [], now);

    // Airborne start (exact ground->air takeoff, else carried forward; null on the ground or
    // when first seen airborne — resolved just below). Drives the "time flying" timer.
    let airborneSince = detectTakeoff(
      prev ? { onGround: prev.onGround, airborneSince: prev.airborneSince } : null,
      { onGround, t: now },
    );

    // LIVE actual DEPARTURE — establish it the first time we'd anchor an airborne start for a
    // leg (then airborneSince carries forward, so this runs once per stint). Only a real-time
    // ground->air transition we actually WITNESSED is a true 'live' takeoff ("now" IS it).
    // Otherwise we're seeing the tail already airborne (server booted mid-flight, or a mid-climb
    // pickup): recover the takeoff from the firehose, labeled 'exact'/'approx' by how it was
    // derived so the reconciler can still refine it. Only as a last resort — no usable history —
    // do we stamp "now", and only when close to schedule; that guess is marked 'approx' too.
    const newlyAirborne = !onGround && prev?.airborneSince == null && leg;
    if (newlyAirborne) {
      const witnessed = prev && prev.onGround === true; // observed the real ground->air this tick
      let dep = null, depSource = null;
      if (witnessed) {
        dep = now; depSource = 'live';
      } else {
        const rec = await recoverDepFromHistory(tail, leg); // { dep, source: 'exact'|'approx'|null }
        if (rec.dep != null) { dep = rec.dep; depSource = rec.source; }
        else if (now <= leg.depTime + MAX_DEP_LATENESS_MS) { dep = now; depSource = 'approx'; }
      }
      if (dep != null) {
        airborneSince = dep; // anchor the timer + the live actual bar at the recovered/observed takeoff
        await recordLegActual(leg.legId, { registration: tail, scheduledDep: leg.depTime, actualDep: dep, depSource });
      }
    }

    // LIVE actual ARRIVAL: air -> ground transition (the destination FBO is usually covered).
    if (prev && prev.onGround === false && onGround === true && leg) {
      await recordLegActual(leg.legId, { registration: tail, scheduledDep: leg.depTime, actualArr: now, arrSource: 'live' });
    }

    if (hasMoved(prev, { lat: p.lat, lon: p.lon }, MOVE_THRESHOLD_DEG)) {
      rows.push({
        registration: tail, lat: p.lat, lon: p.lon,
        altitude_ft: Number.isFinite(p.altitudeFt) ? p.altitudeFt : null,
        on_ground: onGround, t: new Date(now).toISOString(),
      });
    }
    last.set(reg, { lat: p.lat, lon: p.lon, onGround, airborneSince });
  }
  if (rows.length) await savePositions(rows);
}

async function prune() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString();
  await pruneOld(cutoff);
}

export function startRecorder() {
  if (started) return;
  started = true;
  tick().catch(() => {});
  setInterval(() => { tick().catch(() => {}); }, RECORD_INTERVAL_MS);
  prune().catch(() => {});
  setInterval(() => { prune().catch(() => {}); }, PRUNE_INTERVAL_MS);
  console.log('[adsbRecorder] started (interval', RECORD_INTERVAL_MS, 'ms, retention', RETENTION_DAYS, 'days)');
}
