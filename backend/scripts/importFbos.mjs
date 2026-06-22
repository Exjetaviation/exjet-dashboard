// One-time / re-runnable FBO backfill. Iterates US-prefix airports (≈4,900) plus any
// ICAO we already fly, fetches FBOs from LevelFlight, upserts into airport_fbos.
// Rate-limited + resumable (skips airports synced in the last RESYNC_DAYS) + logs
// zero-FBO airports. Run from backend/: `node scripts/importFbos.mjs`
import 'dotenv/config';
import { readFileSync } from 'fs';
import { supabase } from '../src/services/supabase.js';
import { fetchAirportFbos, upsertFbos } from '../src/services/fbos.js';

const RESYNC_DAYS = 30;
const DELAY_MS = 200; // be polite to LF
const US_PREFIX = /^(K|PA|PH|PG|PJ|TI|TJ)/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const names = JSON.parse(readFileSync(new URL('../src/scheduling/data/airportNames.json', import.meta.url)));
const usIcaos = Object.keys(names).filter((k) => US_PREFIX.test(k));

// Plus airports we actually fly (any region).
const { data: legRows } = await supabase.from('scheduling_legs').select('dep_icao, arr_icao');
const flown = new Set();
for (const l of legRows || []) { if (l.dep_icao) flown.add(l.dep_icao); if (l.arr_icao) flown.add(l.arr_icao); }
const targets = [...new Set([...usIcaos, ...flown])].filter(Boolean);

// Resume: skip airports already synced recently.
const since = new Date(Date.now() - RESYNC_DAYS * 86400000).toISOString();
const { data: recent } = await supabase.from('airport_fbos').select('icao, synced_at').gte('synced_at', since);
const done = new Set((recent || []).map((r) => r.icao));

let withFbos = 0, zero = 0, failed = 0;
console.log(`Targets: ${targets.length} (skipping ${done.size} synced in last ${RESYNC_DAYS}d)`);
for (let i = 0; i < targets.length; i++) {
  const icao = targets[i];
  if (done.has(icao)) continue;
  try {
    const rows = await fetchAirportFbos(icao);
    if (rows.length) { await upsertFbos(rows); withFbos++; }
    else { zero++; }
  } catch (e) { failed++; console.warn(`  ${icao}: ${e.message}`); }
  if (i % 100 === 0) console.log(`  …${i}/${targets.length} (fbos:${withFbos} zero:${zero} fail:${failed})`);
  await sleep(DELAY_MS);
}
console.log(`Done. airports with FBOs: ${withFbos}, zero-FBO: ${zero}, failed: ${failed}`);
