// backend/src/services/adsbRecorder.js
// Always-on background poller. Starts with the server and records fleet ADS-B
// positions every RECORD_INTERVAL_MS regardless of whether any client is
// connected, so flight tracks accumulate continuously. Maintains in-memory
// airborneSince per aircraft for the "time flying" timer, and prunes old rows.

import { getLivePositions } from './adsb.js';
import { savePositions, pruneOld } from './adsbStore.js';
import { hasMoved, detectTakeoff, normReg, matchActiveLeg } from './adsbTrack.js';
import { getActiveLegsByTail } from './activeLegs.js';
import { recordLegActual } from './legActualsStore.js';

// getLivePositions() caches for ~20s, so polling faster just re-reads the same
// snapshot — match the cache TTL so each tick gets a fresh fix.
const RECORD_INTERVAL_MS = 20000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000; // hourly
const RETENTION_DAYS = 14; // raw firehose only; permanent history lives in flight_tracks
const MOVE_THRESHOLD_DEG = 0.0005;

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

    // Takeoff time from the ground->air transition. If we boot mid-flight (no
    // prev) and it's airborne, detectTakeoff returns null and the timer stays
    // hidden until we observe a real takeoff — honest over guessing.
    const airborneSince = detectTakeoff(
      prev ? { onGround: prev.onGround, airborneSince: prev.airborneSince } : null,
      { onGround, t: now },
    );

    // LIVE actual dep/arr: stamp the leg the moment we observe a transition. This is
    // the reliable source (full stream, no movement gate) — see legActualsStore.js.
    if (prev && prev.onGround !== onGround) {
      const tail = normReg(reg);
      const leg = matchActiveLeg(activeLegs.get(tail) || [], now);
      if (leg) {
        if (onGround === false) { // ground -> air = takeoff
          await recordLegActual(leg.legId, { registration: tail, scheduledDep: leg.depTime, actualDep: now, depSource: 'live' });
        } else {                  // air -> ground = landing
          await recordLegActual(leg.legId, { registration: tail, scheduledDep: leg.depTime, actualArr: now, arrSource: 'live' });
        }
      }
    }

    if (hasMoved(prev, { lat: p.lat, lon: p.lon }, MOVE_THRESHOLD_DEG)) {
      rows.push({
        registration: normReg(reg), lat: p.lat, lon: p.lon,
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
