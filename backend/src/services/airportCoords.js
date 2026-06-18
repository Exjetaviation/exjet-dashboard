// Airport coordinates sourced from LevelFlight's own leg data — the SAME source the
// flights-page map uses (`leg._calc.from/to.location`). Builds an ICAO -> [lat,lng]
// lookup from every scheduled + completed leg across a window, so the quote route
// map covers the fleet's real network without a hardcoded table. Cached in-memory.
import * as lf from './levelflight.js';
import { monthAnchors } from './adsbTrack.js';

const TTL_MS = 60 * 60 * 1000; // 1h
let cache = { at: 0, map: null };

export async function getAirportCoords() {
  if (cache.map && Date.now() - cache.at < TTL_MS) return cache.map;
  const map = new Map();
  const now = Date.now();
  const anchors = monthAnchors(now - 90 * 86400000, now + 90 * 86400000);
  const results = await Promise.all(
    anchors.flatMap((ts) => [
      lf.getScheduledLegs(ts).catch(() => ({ legs: [] })),
      lf.getDutyTimes(ts).catch(() => ({ legs: [] })),
    ]),
  );
  for (const r of results) {
    for (const l of (r?.legs || [])) {
      const dep = l?.departure?.airport, arr = l?.arrival?.airport;
      const dloc = l?._calc?.from?.location, aloc = l?._calc?.to?.location;
      if (dep && dloc?.lat != null && dloc?.lng != null && !map.has(dep)) map.set(dep, [dloc.lat, dloc.lng]);
      if (arr && aloc?.lat != null && aloc?.lng != null && !map.has(arr)) map.set(arr, [aloc.lat, aloc.lng]);
    }
  }
  cache = { at: now, map };
  return map;
}

// Attach fromLatLng/toLatLng to legs from the coords lookup (unknown ICAO -> null,
// so the map degrades gracefully).
export function attachCoords(legs, coords) {
  return legs.map((l) => ({ ...l, fromLatLng: coords.get(l.from) || null, toLatLng: coords.get(l.to) || null }));
}
