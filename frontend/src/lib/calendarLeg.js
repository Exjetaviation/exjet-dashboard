// frontend/src/lib/calendarLeg.js
// Pure helpers shared between the Gantt (Calendar.jsx) and the phone agenda
// (CalendarAgenda.jsx). No React imports — this module is safe to use in
// node:test without a DOM.

export const STATUS = {
  0: { label: 'Scheduled' },
  1: { label: 'Active' },
  2: { label: 'Booked' },
  3: { label: 'Completed' },
};

// Block colour by flight STATE (uses actuals when known): completed/landed = blue,
// in-flight = green, future/not-yet-departed = grey.
export const STATE_COLORS = { completed: '#4f8ef7', inflight: '#22c55e', future: '#64748b' };

// Whether to TRUST/show an actual arrival: present, and not before a known departure
// (arr <= dep = corrupt → ignore). An arrival with NO recorded departure is still valid
// — ADS-B routinely misses the wheels-up — so a flight that lands without a captured
// takeoff still renders (scheduled departure as the bar start) instead of vanishing on
// landing. (The backend matcher's coherentArrival stays stricter on purpose.)
export const arrShown = (dep, arr) => arr != null && (dep == null || arr > dep);

export function legStateColor(leg, isAirborne, act, now) {
  const dep = leg?.departure?.time, arr = leg?.arrival?.time;
  const aDep = act?.actualDep ?? null;
  const aArr = arrShown(act?.actualDep, act?.actualArr) ? act.actualArr : null; // ignore only corrupt arrivals (arr<=dep)
  if (isAirborne) return STATE_COLORS.inflight;                                   // ADS-B says airborne
  if (aArr != null) return aArr <= now ? STATE_COLORS.completed : STATE_COLORS.inflight; // truly landed
  if (aDep != null) {
    // Departed but no coherent arrival: in-flight, never "complete" on a corrupt
    // arrival. Assume landed only well past schedule (ADS-B missed the arrival).
    return (arr != null && now > arr + 3 * 3600000) ? STATE_COLORS.completed : STATE_COLORS.inflight;
  }
  // No actual departure recorded → fall back to the schedule clock.
  if (dep != null && dep > now) return STATE_COLORS.future;                       // not yet departed
  if (dep != null && arr != null && dep <= now && now < arr) return STATE_COLORS.inflight; // mid-flight by clock
  if (arr != null && arr <= now) return STATE_COLORS.completed;
  return STATE_COLORS.future;
}

export const floorDay = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };

// Great-circle distance in nautical miles between two lat/lon points (haversine).
// Returns null if any coordinate is missing.
export function nmBetween(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some(v => v == null || Number.isNaN(v))) return null;
  const R = 3440.065; // Earth radius in nautical miles
  const rad = d => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// How close (nm) an on-ground fix must be to the scheduled arrival airport to
// count as "landed there" — covers the airport footprint + FBO ramp.
export const ARR_CONFIRM_NM = 5;

// A departed leg has effectively LANDED at its scheduled arrival when the
// aircraft's current OR last-known ADS-B fix shows it on the ground within a few
// nm of that airport. This rescues the common case where ADS-B never logged the
// exact air→ground touchdown tick (so no actual_arr was recorded) yet the jet is
// plainly parked at the destination — without it the leg would show an alarming
// amber "unconfirmed" bar until crew log OOOI block times or the hourly backfill.
// `la` = the /positions entry for the tail ({lat, lon, onGround, stale?}).
// `arrLoc` = the scheduled arrival airport coords ({lat, lng}).
export function landedAtDestination(la, arrLoc, maxNm = ARR_CONFIRM_NM) {
  if (!la || la.onGround !== true) return false;
  if (!arrLoc || arrLoc.lat == null || la.lat == null) return false;
  const d = nmBetween(la.lat, la.lon, arrLoc.lat, arrLoc.lng);
  return d != null && d <= maxNm;
}
