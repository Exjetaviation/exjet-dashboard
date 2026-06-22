// One-time / re-runnable FBO backfill. Iterates US-prefix airports (≈4,900) plus any
// ICAO we already fly, fetches FBOs from LevelFlight, upserts into airport_fbos.
// Rate-limited + resumable: a local checkpoint file records EVERY airport checked
// (with or without FBOs) so re-runs/interruptions skip anything checked in the last
// RESYNC_DAYS. Logs zero-FBO + failures. Run from backend/: `node scripts/importFbos.mjs`
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'fs';
import { supabase } from '../src/services/supabase.js';
import { fetchAirportFbos, upsertFbos } from '../src/services/fbos.js';

const RESYNC_DAYS = 30;
const DELAY_MS = 200; // be polite to LF
const US_PREFIX = /^(K|PA|PH|PG|PJ|TI|TJ)/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CKPT = new URL('./.fbo-import-checkpoint.json', import.meta.url); // { icao: ISO checkedAt }, gitignored

const names = JSON.parse(readFileSync(new URL('../src/scheduling/data/airportNames.json', import.meta.url)));
const usIcaos = Object.keys(names).filter((k) => US_PREFIX.test(k));

// Plus airports we actually fly (any region).
const { data: legRows } = await supabase.from('scheduling_legs').select('dep_icao, arr_icao');
const flown = new Set();
for (const l of legRows || []) { if (l.dep_icao) flown.add(l.dep_icao); if (l.arr_icao) flown.add(l.arr_icao); }
const targets = [...new Set([...usIcaos, ...flown])].filter(Boolean);

// Resume: skip airports checked within RESYNC_DAYS — from the local checkpoint (covers
// zero-FBO airports too) plus airport_fbos.synced_at (belt-and-suspenders).
const cutoff = Date.now() - RESYNC_DAYS * 86400000;
const checkpoint = (() => { try { return JSON.parse(readFileSync(CKPT)); } catch { return {}; } })();
const done = new Set(Object.entries(checkpoint).filter(([, t]) => Date.parse(t) >= cutoff).map(([i]) => i));
const { data: recent } = await supabase.from('airport_fbos').select('icao').gte('synced_at', new Date(cutoff).toISOString());
for (const r of recent || []) done.add(r.icao);

const flush = () => writeFileSync(CKPT, JSON.stringify(checkpoint));
let withFbos = 0, zero = 0, failed = 0;
console.log(`Targets: ${targets.length} (skipping ${done.size} checked in last ${RESYNC_DAYS}d)`);
for (let i = 0; i < targets.length; i++) {
  const icao = targets[i];
  if (done.has(icao)) continue;
  try {
    const rows = await fetchAirportFbos(icao);
    if (rows.length) { await upsertFbos(rows); withFbos++; } else { zero++; }
    checkpoint[icao] = new Date().toISOString(); // record EVERY checked airport (FBO or zero)
  } catch (e) { failed++; console.warn(`  ${icao}: ${e.message}`); }
  if (i % 100 === 0) { flush(); console.log(`  …${i}/${targets.length} (fbos:${withFbos} zero:${zero} fail:${failed})`); }
  await sleep(DELAY_MS);
}
flush();
console.log(`Done. airports with FBOs: ${withFbos}, zero-FBO: ${zero}, failed: ${failed}`);
