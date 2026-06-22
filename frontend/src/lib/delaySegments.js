// frontend/src/lib/delaySegments.js
// Pure: from a leg's scheduled + actual dep/arr (and live ADS-B state), produce the
// colored delta segments the calendar overlays on the scheduled block. Red = late,
// green = early; only deltas >= the threshold are shown. Each segment is a time
// interval { from, to } the caller positions with the calendar's ms->px math.
//
// Sources of the "actual" time, in priority order:
//   1. persisted actual (actualDep/actualArr) — settled, from /api/adsb/actuals
//   2. live wheels-up (airborneSinceMs) when this tail is airborne on this leg
//   3. live "still open": on the ground past scheduled dep, or airborne past
//      scheduled arr -> the delta grows to `now` until the transition lands.

export const DELAY_THRESHOLD_MS = 5 * 60 * 1000;

export function delaySegments({
  dep, arr, actualDep = null, actualArr = null, depSource = null, arrSource = null,
  now, onGround = false, airborne = false, airborneSinceMs = null,
}) {
  const out = [];
  if (dep == null || arr == null || now == null) return out;

  // Departure delta.
  let effDep = actualDep;
  let depApprox = depSource === 'approx';
  let depLive = false;
  if (effDep == null && airborne && airborneSinceMs != null) { effDep = airborneSinceMs; depLive = true; depApprox = false; }
  if (effDep == null && onGround && now > dep) { effDep = now; depLive = true; depApprox = false; } // still on the ground
  if (effDep != null && Math.abs(effDep - dep) >= DELAY_THRESHOLD_MS) {
    const late = effDep > dep;
    out.push({ edge: 'dep', kind: late ? 'late' : 'early', from: late ? dep : effDep, to: late ? effDep : dep, approx: depApprox, live: depLive });
  }

  // Arrival delta.
  let effArr = actualArr;
  let arrApprox = arrSource === 'approx';
  let arrLive = false;
  if (effArr == null && airborne && now > arr) { effArr = now; arrLive = true; arrApprox = false; } // still airborne past arr
  if (effArr != null && Math.abs(effArr - arr) >= DELAY_THRESHOLD_MS) {
    const late = effArr > arr;
    out.push({ edge: 'arr', kind: late ? 'late' : 'early', from: late ? arr : effArr, to: late ? effArr : arr, approx: arrApprox, live: arrLive });
  }

  return out;
}
