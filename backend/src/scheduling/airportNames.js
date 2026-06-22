import { readFileSync } from 'fs';

// Friendly airport names (ICAO → { n: name, c: city, r: region }). Bundled dataset.
const NAMES = JSON.parse(readFileSync(new URL('./data/airportNames.json', import.meta.url)));

// Full airport name for an ICAO, or null if unknown.
export const airportName = (icao) => {
  const rec = NAMES[(icao || '').trim().toUpperCase()];
  return rec?.n || null;
};
