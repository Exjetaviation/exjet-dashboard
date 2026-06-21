// backend/src/scheduling/airportSearch.js
//
// Ranked airport lookup for the New Quote dropdown. The search universe is the set
// of codes the flight-time engine can actually compute (data/airports.json), so every
// suggestion is a quotable airport. Display names/cities come from data/airportNames.json
// (see scripts/harvestAirportNames.mjs); codes with no overlay still appear, code-only.
import { readFileSync } from 'node:fs';

// Build a flat, search-ready index from the coordinate universe + the name overlay.
// coords: { CODE: {lat,lng} }  names: { CODE: {n,c,r} }  ->  [{ code, name, city, region, hay, tokens }]
export function buildAirportIndex(coords, names = {}) {
  const index = [];
  for (const rawCode of Object.keys(coords)) {
    const code = rawCode.toUpperCase();
    const overlay = names[code] || {};
    const name = overlay.n || '';
    const city = overlay.c || '';
    const region = overlay.r || '';
    const hay = `${name} ${city}`.toLowerCase();
    const tokens = hay.split(/[^a-z0-9]+/).filter(Boolean);
    index.push({ code, name, city, region, hay, tokens });
  }
  return index;
}

// Rank tiers (lower = better): exact code, code prefix, name/city word-start, name/city substring.
function score(entry, q, qLower) {
  if (entry.code === q) return 0;
  if (entry.code.startsWith(q)) return 1;
  if (entry.tokens.some((t) => t.startsWith(qLower))) return 2;
  if (entry.hay.includes(qLower)) return 3;
  return null;
}

const PUBLIC = ({ code, name, city, region }) => ({ code, name, city, region });

export function searchAirports(index, query, limit = 8) {
  const q = String(query || '').trim().toUpperCase();
  if (!q) return [];
  const qLower = q.toLowerCase();

  const scored = [];
  for (const entry of index) {
    const s = score(entry, q, qLower);
    if (s != null) scored.push({ entry, s });
  }
  scored.sort((a, b) =>
    a.s - b.s ||
    a.entry.code.length - b.entry.code.length ||
    (a.entry.code < b.entry.code ? -1 : a.entry.code > b.entry.code ? 1 : 0));

  return scored.slice(0, limit).map((x) => PUBLIC(x.entry));
}

// Lazily build the index from the bundled data files; memoized for the route.
let _index = null;
export function defaultAirportIndex() {
  if (!_index) {
    const coords = JSON.parse(readFileSync(new URL('./data/airports.json', import.meta.url)));
    let names = {};
    try {
      names = JSON.parse(readFileSync(new URL('./data/airportNames.json', import.meta.url)));
    } catch { /* names overlay optional — fall back to code-only */ }
    _index = buildAirportIndex(coords, names);
  }
  return _index;
}
