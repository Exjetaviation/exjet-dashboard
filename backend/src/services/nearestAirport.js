import { readFileSync } from 'node:fs';
import { greatCircleNm } from '../scheduling/distance.js';

// The quotable-universe coordinate file (~43k ICAO -> {lat,lng}); same source the
// flight-time engine uses. Loaded once.
const AIRPORTS = JSON.parse(readFileSync(new URL('../scheduling/data/airports.json', import.meta.url)));
const LIST = Object.entries(AIRPORTS).map(([icao, c]) => ({ icao, lat: c.lat, lng: c.lng }));

// Nearest airport ({ icao, distanceNm }) to a lat/lon within `maxNm`, else null.
// Used to flag a possible diversion: the last ADS-B fix's nearest airport differs from
// the leg's scheduled arrival. A linear scan (~43k haversines) — cheap for a handful of
// fleet tails on the 20s poll.
// Coordinates ({ lat, lng }) for an ICAO, or null. Used to place a diverted plane at
// its actual landing airport on the map.
export function airportCoords(icao) {
  const a = icao && AIRPORTS[String(icao).toUpperCase()];
  return a ? { lat: a.lat, lng: a.lng } : null;
}

export function nearestAirport(lat, lon, maxNm = 25) {
  if (lat == null || lon == null) return null;
  const p = { lat, lng: lon };
  let best = null;
  let bestD = Infinity;
  for (const a of LIST) {
    const d = greatCircleNm(p, a);
    if (d != null && d < bestD) { bestD = d; best = a; }
  }
  return best && bestD <= maxNm ? { icao: best.icao, distanceNm: Math.round(bestD) } : null;
}
