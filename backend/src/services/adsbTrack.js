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

// Earliest AIRBORNE sample time (epoch ms) for a leg from a tail's firehose positions, within
// the leg's padded [depTime - pad, arrTime + pad] window. The live recorder uses this to
// recover a real takeoff time from history when it sees a tail already airborne (server booted
// mid-flight, or ADS-B picked the plane up mid-climb) and deriveActualTimes found no clean
// transition — so we anchor the bar to when the flight was first SEEN airborne, not "now".
// Unlike approximateActualTimes it has no coverage guard (that guard exists to protect the
// ARRIVAL endpoint; the first airborne sample is a fine departure estimate). null if none.
export function firstAirborneTime(positions, leg, padMs) {
  const lo = leg.depTime - padMs;
  const hi = leg.arrTime + padMs;
  let min = null;
  for (const p of positions || []) {
    if (p.on_ground === false && p.t >= lo && p.t <= hi && (min == null || p.t < min)) min = p.t;
  }
  return min;
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

// Derive ACTUAL departure/arrival (epoch ms, or null) from a tail's firehose
// positions ({ t, on_ground }) within a leg's [depTime - pad, arrTime + pad] window.
//   actualDep = first OBSERVED ground->air transition (prev on-ground, next airborne)
//   actualArr = first air->ground transition AFTER that departure
// Requires a real transition, so a track that starts mid-air (we booted/began logging
// after takeoff) yields actualDep=null rather than a fabricated time — honest over
// guessing, matching detectTakeoff. ~20s precision (the poll interval).
export function deriveActualTimes(positions, leg, padMs) {
  const lo = leg.depTime - padMs;
  const hi = leg.arrTime + padMs;
  const pts = (positions || []).filter((p) => p.t >= lo && p.t <= hi).sort((a, b) => a.t - b.t);
  let actualDep = null;
  let actualArr = null;
  for (let i = 1; i < pts.length; i++) {
    const prevGround = !!pts[i - 1].on_ground;
    const curGround = !!pts[i].on_ground;
    if (actualDep == null) {
      if (prevGround && !curGround) actualDep = pts[i].t; // ground -> air
    } else if (!prevGround && curGround) {
      actualArr = pts[i].t; // air -> ground after departure
      break;
    }
  }
  return { actualDep, actualArr };
}

// Recover a leg's DEPARTURE (epoch ms) + its true source from a tail's firehose positions, for
// the live recorder when it first sees a tail already airborne (server booted mid-flight, or a
// mid-climb pickup) with no real-time takeoff to witness. Labeled by HOW it was derived — an
// exact ground->air transition -> { source: 'exact' }, else the earliest airborne sample ->
// { source: 'approx' } — deliberately NOT 'live'. Keeping it 'exact'/'approx' lets the hourly
// reconciler (and crew OOOI) still refine it, and keeps the unguarded first-airborne estimate at
// the lowest priority instead of locking out a better value. { dep: null, source: null } when
// there is no usable airborne history.
export function recoverDepFromPositions(positions, leg, padMs) {
  const exactDep = deriveActualTimes(positions, leg, padMs).actualDep;
  if (exactDep != null) return { dep: exactDep, source: 'exact' };
  const firstUp = firstAirborneTime(positions, leg, padMs);
  return firstUp != null ? { dep: firstUp, source: 'approx' } : { dep: null, source: null };
}

// Approximate dep/arr (epoch ms, or null) for a leg from the FIRST and LAST airborne
// samples in its window — the fallback for when crowd-sourced ADS-B never reported the
// on-ground portion, so deriveActualTimes found no clean transition. A few minutes off
// (the plane enters/leaves receiver coverage shortly after takeoff / before landing).
//
// GUARD: only trust the endpoints when the airborne samples span at least `minCoverage`
// of the scheduled duration. A tiny sliver of coverage (e.g. a few samples just after
// takeoff before the plane leaves receiver range) does NOT bracket the flight, and its
// "last airborne" would fake a wildly-early arrival — so we return nulls instead.
export function approximateActualTimes(positions, leg, padMs, { minCoverage = 0.5 } = {}) {
  const lo = leg.depTime - padMs;
  const hi = leg.arrTime + padMs;
  const air = (positions || [])
    .filter((p) => p.t >= lo && p.t <= hi && p.on_ground === false)
    .sort((a, b) => a.t - b.t);
  if (!air.length) return { actualDep: null, actualArr: null };
  const span = air[air.length - 1].t - air[0].t;
  const dur = leg.arrTime - leg.depTime;
  if (dur > 0 && span < minCoverage * dur) return { actualDep: null, actualArr: null };
  return { actualDep: air[0].t, actualArr: air[air.length - 1].t };
}

// Crew-entered actual block times from a raw LevelFlight leg, when logged post-flight
// (the postFlight module). leg.block = { out (block-out/gate), off (wheels-up),
// on (wheels-down), in (block-in/gate) }, all epoch ms. We use OUT -> actual departure
// and IN -> actual arrival (gate-to-gate), the same basis as LF's scheduled
// departure/arrival times. Returns null when no block times are entered yet.
export function crewActualsFromLeg(leg) {
  const b = leg?.block;
  if (!b || (b.out == null && b.in == null)) return null;
  const legId = leg?._id?.$oid;
  if (!legId) return null;
  return {
    legId,
    tail: legTail(leg),
    scheduledDep: leg?.departure?.time ?? null,
    actualDep: b.out ?? null,
    actualArr: b.in ?? null,
  };
}

// Match a live takeoff/landing observed at `now` to the tail's scheduled leg: the leg
// whose [depTime - preMs, arrTime + postMs] window contains `now`, preferring the most
// recent departure (mirrors the calendar's airborne-leg match). null if none.
export function matchActiveLeg(legs, now, { preMs = 2 * 3600000, postMs = 6 * 3600000 } = {}) {
  let best = null;
  for (const l of legs || []) {
    if (l?.depTime == null || l?.arrTime == null) continue;
    if (now >= l.depTime - preMs && now <= l.arrTime + postMs) {
      if (!best || l.depTime > best.depTime) best = l;
    }
  }
  return best;
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
