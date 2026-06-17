// Pure helpers for ADS-B track recording and previous-flight reconstruction.
// No I/O — unit-tested in adsbTrack.test.js.

// Canonical aircraft key: uppercase, alphanumeric only. The recorder stores
// positions keyed by the ADS-B fleet registration while previous-flights looks
// them up by LevelFlight's tailNumber — normalizing both sides means a value
// like "N-69FP" or "n69fp" still matches "N69FP".
export function normReg(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// True if `next` differs from `prev` by more than `thresholdDeg` in lat+lon
// (Manhattan in degrees, matching the existing trail dedup). No prev => true.
export function hasMoved(prev, next, thresholdDeg) {
  if (!prev) return true;
  return Math.abs(next.lat - prev.lat) + Math.abs(next.lon - prev.lon) >= thresholdDeg;
}

// Given the previous sample ({ onGround, airborneSince }) and the next
// observation ({ onGround, t }), return the new airborneSince (epoch ms or null).
//   ground -> airborne : takeoff, returns next.t
//   on ground          : returns null (parked/landed)
//   airborne -> airborne: carries the prior airborneSince
//   no prev + airborne : null (unknown; timer hidden until a real takeoff)
export function detectTakeoff(prev, next) {
  if (next.onGround) return null;
  if (!prev) return null;
  if (prev.onGround) return next.t;
  return prev.airborneSince ?? null;
}

// Clip a time-ordered position list to a leg's [depTime - pad, arrTime + pad]
// window and return [[lat, lon], ...] for a Leaflet polyline.
export function clipTrackToLeg(positions, leg, padMs) {
  const lo = leg.depTime - padMs;
  const hi = leg.arrTime + padMs;
  return positions
    .filter((p) => p.t >= lo && p.t <= hi)
    .sort((a, b) => a.t - b.t)
    .map((p) => [p.lat, p.lon]);
}

// Months (UTC, 1st of month) spanning [startMs, endMs], plus the prior month, as
// anchor timestamps for LevelFlight's scheduledLegs queries. Moved here from
// routes/adsb.js so the reconciler can reuse it.
export function monthAnchors(startMs, endMs) {
  const out = []; const d = new Date(startMs);
  let y = d.getUTCFullYear(), m = d.getUTCMonth();
  for (;;) { const t = Date.UTC(y, m, 1); if (t > endMs) break; out.push(t); m++; if (m > 11) { m = 0; y++; } if (out.length > 24) break; }
  out.unshift(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  return out;
}

// Normalized tail number for a LevelFlight leg.
export function legTail(leg) {
  return normReg(leg?.dispatch?.aircraft?.tailNumber || leg?.aircraft?.tailNumber || '');
}

// From raw LevelFlight leg lists, return de-duplicated COMPLETED legs (arrival in
// the past), normalized to { id, tail, from, to, depTime, arrTime }. `now` is
// epoch ms. Pure — no I/O.
export function selectCompletedLegs(legs, now) {
  const seen = new Set();
  const out = [];
  for (const l of legs || []) {
    const id = l?._id?.$oid;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const depTime = l?.departure?.time, arrTime = l?.arrival?.time;
    if (!depTime || !arrTime) continue;
    if (arrTime > now) continue; // not completed yet
    out.push({ id, tail: legTail(l), from: l.departure?.airport, to: l.arrival?.airport, depTime, arrTime });
  }
  return out;
}

// Drop legs whose id is already stored. `existingIds` is a Set. Pure.
export function selectLegsToSnapshot(completedLegs, existingIds) {
  return completedLegs.filter((leg) => !existingIds.has(leg.id));
}
