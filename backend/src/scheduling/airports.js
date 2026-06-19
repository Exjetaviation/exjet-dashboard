import { readFileSync } from 'node:fs';

// ICAO -> { lat, lng }. Generated from the mirror by scripts/harvestAirports.mjs
// (LevelFlight's own coordinates). Regenerate to add airports as the fleet flies
// new fields, or hand-add entries to data/airports.json.
const AIRPORTS = JSON.parse(readFileSync(new URL('./data/airports.json', import.meta.url)));

export function airportCoord(icao) {
  if (!icao || typeof icao !== 'string') return null;
  return AIRPORTS[icao.trim().toUpperCase()] || null;
}
