// backend/scripts/harvestAirportNames.mjs
//
// Attach human-readable names/cities to the airport codes we already know about.
//
// Source of truth for *which* codes matter stays data/airports.json (the codes the
// flight-time engine can actually compute, harvested from the LevelFlight mirror).
// This script overlays display names onto that universe using the public-domain
// OurAirports dataset (CC0), so the New Quote dropdown can show "KFXE — Fort
// Lauderdale Executive, FL" instead of a bare code. Codes with no name match are
// omitted (the UI falls back to showing the code alone).
//
// Run:  node scripts/harvestAirportNames.mjs
// Out:  src/scheduling/data/airportNames.json   ({ CODE: { n, c, r } })

import { readFileSync, writeFileSync } from 'node:fs';

const SRC = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const COORDS_PATH = new URL('../src/scheduling/data/airports.json', import.meta.url);
const OUT_PATH = new URL('../src/scheduling/data/airportNames.json', import.meta.url);

// Minimal RFC-4180 CSV parser (OurAirports quotes fields that contain commas).
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// iso_region like "US-FL" -> "FL"; "GB-ENG" -> "ENG". Falls back to country code.
function shortRegion(isoRegion, isoCountry) {
  if (isoRegion && isoRegion.includes('-')) return isoRegion.split('-').slice(1).join('-');
  return isoCountry || '';
}

async function main() {
  const universe = JSON.parse(readFileSync(COORDS_PATH));
  const wanted = new Set(Object.keys(universe).map((k) => k.toUpperCase()));
  console.log(`Universe: ${wanted.size} codes from airports.json`);

  console.log(`Fetching ${SRC} ...`);
  const res = await fetch(SRC);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const rows = parseCsv(await res.text());

  const header = rows[0];
  const col = (name) => header.indexOf(name);
  const cIdent = col('ident'), cName = col('name'), cIso = col('iso_region');
  const cMun = col('municipality'), cCountry = col('iso_country');
  const cIcao = col('icao_code'), cIata = col('iata_code');
  const cGps = col('gps_code'), cLocal = col('local_code');

  // Register each row under every code form it carries, highest-priority first so
  // we don't clobber a primary (ident/ICAO) match with a weaker (IATA/local) one.
  const index = new Map();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row[cName]) continue;
    const entry = {
      n: row[cName].trim(),
      c: (row[cMun] || '').trim(),
      r: shortRegion(row[cIso], row[cCountry]),
    };
    const codes = [row[cIdent], row[cIcao], row[cGps], row[cLocal], row[cIata]];
    for (const raw of codes) {
      const code = (raw || '').trim().toUpperCase();
      if (code && !index.has(code)) index.set(code, entry);
    }
  }

  const out = {};
  let matched = 0;
  for (const code of wanted) {
    const e = index.get(code);
    if (e) { out[code] = e; matched++; }
  }

  // Stable, sorted output for clean diffs.
  const sorted = {};
  for (const code of Object.keys(out).sort()) sorted[code] = out[code];
  writeFileSync(OUT_PATH, JSON.stringify(sorted) + '\n');

  console.log(`Matched names for ${matched}/${wanted.size} codes (${(100 * matched / wanted.size).toFixed(1)}%)`);
  console.log(`Wrote ${OUT_PATH.pathname}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
