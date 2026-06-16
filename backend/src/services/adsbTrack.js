// Pure helpers for ADS-B track recording and previous-flight reconstruction.
// No I/O — unit-tested in adsbTrack.test.js.

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
