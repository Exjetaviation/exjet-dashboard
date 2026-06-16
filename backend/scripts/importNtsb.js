#!/usr/bin/env node
// Import the NTSB national database (avall.mdb, Microsoft Access) into Supabase.
//
//   node scripts/importNtsb.js --mdb ~/Downloads/avall.mdb --dry-run
//   node scripts/importNtsb.js --zip ./avall.zip          # extract then import
//   node scripts/importNtsb.js --mdb ./avall.mdb          # already-extracted
//
// avall.zip from the NTSB contains a relational Access database — the fields we
// need live in separate tables (events, aircraft, narratives, engines,
// Occurrences) joined on ev_id (+ Aircraft_Key). We read each with `mdb-export`
// (Homebrew: brew install mdbtools), stream-parse with papaparse, join, decode
// the NTSB codes, then write two tables:
//   ntsb_raw                — one row per airplane (reference only)
//   ntsb_airport_profiles   — one pre-aggregated row per airport (what the
//                             agent queries)
// Run manually; refresh quarterly. --dry-run computes everything but writes
// nothing (and prints a sample profile).

import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import Papa from 'papaparse';
import {
  DAMAGE, INJURY, WEATHER, ENGINE, decode, broadPhase, buildAirportProfile,
} from './ntsbProfile.js';

const DB_BATCH = 500;
const NARRATIVE_MAX = 6000; // cap stored narrative length

/* ─────────────── mdb streaming ─────────────── */

function ensureMdbTools() {
  try { execFileSync('which', ['mdb-export'], { stdio: 'ignore' }); }
  catch { throw new Error('mdb-export not found. Install mdbtools: brew install mdbtools'); }
}

// Stream one MDB table through papaparse, calling onRow(rowObject) per record.
function streamTable(mdb, table, onRow) {
  return new Promise((resolve, reject) => {
    const child = spawn('mdb-export', ['-D', '%Y-%m-%d', mdb, table]);
    let stderr = '';
    child.on('error', reject);
    child.stderr.on('data', (d) => { stderr += d; });
    Papa.parse(child.stdout, {
      header: true,
      skipEmptyLines: true,
      step: (res) => { try { onRow(res.data); } catch { /* skip bad row */ } },
      complete: () => resolve(),
      error: reject,
    });
    child.on('close', (code) => { if (code !== 0) reject(new Error(`mdb-export ${table} exited ${code}: ${stderr.trim()}`)); });
  });
}

const keyOf = (evId, acftKey) => `${evId}|${acftKey}`;
const clean = (v) => { const s = String(v ?? '').trim(); return s === '' ? null : s; };

// mdb-export ignores -D in this build, so dates arrive as "MM/DD/YY HH:MM:SS".
// Convert to ISO; 2-digit years split at 30 (data spans 1982–present).
function parseNtsbDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);     // MM/DD/YYYY
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})\b/);        // MM/DD/YY
  if (m) { const yy = Number(m[3]); const yr = yy < 30 ? 2000 + yy : 1900 + yy; return `${yr}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);                // already ISO
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/* ─────────────── build raw rows from the MDB ─────────────── */

async function buildRawRows(mdb, { onProgress } = {}) {
  // 1) Phase code → meaning, from the data dictionary (broad phase = before " - ").
  const phaseMap = {};
  await streamTable(mdb, 'eADMSPUB_DataDictionary', (r) => {
    if (/phase/i.test(r.ct_name || '') && r.code_iaids && r.meaning) phaseMap[String(r.code_iaids).trim()] = r.meaning;
  });

  // 2) events → by ev_id.
  const events = new Map();
  await streamTable(mdb, 'events', (r) => {
    if (!r.ev_id) return;
    events.set(r.ev_id, {
      ntsb_no: clean(r.ntsb_no),
      event_date: parseNtsbDate(r.ev_date),
      airport_code: (clean(r.ev_nr_apt_id) || '').toUpperCase() || null,
      airport_name: clean(r.apt_name),
      city: clean(r.ev_city),
      state: clean(r.ev_state),
      latitude: clean(r.latitude),
      longitude: clean(r.longitude),
      weather_condition: decode(WEATHER, r.wx_cond_basic),
      injury_severity: decode(INJURY, r.ev_highest_injury),
    });
  });

  // 3) narratives → probable cause + (truncated) narrative, by ev_id|Aircraft_Key.
  const narr = new Map();
  await streamTable(mdb, 'narratives', (r) => {
    if (!r.ev_id) return;
    const factual = clean(r.narr_accf) || clean(r.narr_accp) || clean(r.narr_inc);
    narr.set(keyOf(r.ev_id, r.Aircraft_Key), {
      cause: clean(r.narr_cause),
      narrative: factual ? factual.slice(0, NARRATIVE_MAX) : null,
    });
  });

  // 4) engines → primary engine type, by ev_id|Aircraft_Key.
  const engines = new Map();
  await streamTable(mdb, 'engines', (r) => {
    if (!r.ev_id) return;
    const k = keyOf(r.ev_id, r.Aircraft_Key);
    if (!engines.has(k) || Number(r.eng_no) === 1) engines.set(k, decode(ENGINE, r.eng_type));
  });

  // (The Occurrences table is empty in this export; phase comes from the
  // aircraft row's phase_flt_spec column instead, decoded via phaseMap.)

  // 5) aircraft (driver) → one raw row per airplane with a usable airport_code.
  const rows = [];
  const seen = new Set();
  let scanned = 0, skippedCat = 0, skippedApt = 0;
  await streamTable(mdb, 'aircraft', (a) => {
    scanned++;
    if (onProgress && scanned % 5000 === 0) onProgress(scanned);
    if (clean(a.acft_category) !== 'AIR') { skippedCat++; return; }
    const ev = events.get(a.ev_id);
    const airport = ev?.airport_code;
    if (!airport) { skippedApt++; return; }

    const k = keyOf(a.ev_id, a.Aircraft_Key);
    const base = clean(a.ntsb_no) || ev.ntsb_no || a.ev_id;
    let ntsb_number = Number(a.Aircraft_Key) > 1 ? `${base}-${a.Aircraft_Key}` : base;
    while (seen.has(ntsb_number)) ntsb_number = `${ntsb_number}_`; // guarantee PK uniqueness
    seen.add(ntsb_number);

    const n = narr.get(k) || {};
    rows.push({
      ntsb_number,
      event_date: ev.event_date,
      airport_code: airport,
      airport_name: ev.airport_name,
      make: clean(a.acft_make),
      model: clean(a.acft_model),
      aircraft_category: 'Airplane',
      number_of_engines: a.num_eng ? Number(a.num_eng) : null,
      engine_type: engines.get(k) || null,
      injury_severity: ev.injury_severity,
      aircraft_damage: decode(DAMAGE, a.damage),
      weather_condition: ev.weather_condition,
      broad_phase_of_flight: broadPhase(a.phase_flt_spec, phaseMap),
      narrative: n.narrative || null,
      probable_cause: n.cause || null,
      latitude: ev.latitude,
      longitude: ev.longitude,
      state: ev.state,
      city: ev.city,
    });
  });

  return { rows, scanned, skippedCat, skippedApt };
}

/* ─────────────── persistence ─────────────── */

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY must be set');
  return createClient(url, key);
}

async function upsertBatched(client, table, rows, conflict) {
  for (let i = 0; i < rows.length; i += DB_BATCH) {
    const batch = rows.slice(i, i + DB_BATCH);
    const { error } = await client.from(table).upsert(batch, { onConflict: conflict });
    if (error) throw new Error(`${table} upsert batch ${i / DB_BATCH} failed: ${error.message}`);
    process.stdout.write(`\r  ${table}: ${Math.min(i + batch.length, rows.length)}/${rows.length}`);
  }
  process.stdout.write('\n');
}

/* ─────────────── CLI ─────────────── */

function parseArgs(argv) {
  const out = { zip: path.resolve(process.cwd(), 'avall.zip') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--zip') out.zip = path.resolve(process.cwd(), argv[++i]);
    else if (a === '--mdb') out.mdb = path.resolve(process.cwd(), argv[++i]);
    else if (a === '--airport') out.airport = String(argv[++i] || '').toUpperCase();
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function resolveMdb(args) {
  if (args.mdb) {
    if (!fs.existsSync(args.mdb)) throw new Error(`MDB not found: ${args.mdb}`);
    return { mdb: args.mdb, cleanup: null };
  }
  if (!fs.existsSync(args.zip)) {
    throw new Error(`Neither --mdb nor a zip at ${args.zip}. Pass --mdb <avall.mdb> or --zip <avall.zip>.`);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ntsb-'));
  console.log(`Extracting ${args.zip} …`);
  execFileSync('unzip', ['-o', args.zip, '-d', dir], { stdio: 'ignore' });
  const mdb = fs.readdirSync(dir).find((f) => f.toLowerCase().endsWith('.mdb'));
  if (!mdb) throw new Error(`no .mdb inside ${args.zip}`);
  return { mdb: path.join(dir, mdb), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function groupByAirport(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.airport_code)) m.set(r.airport_code, []);
    m.get(r.airport_code).push(r);
  }
  return m;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/importNtsb.js [--mdb avall.mdb | --zip avall.zip] [--dry-run] [--airport KFLL]');
    process.exit(0);
  }
  ensureMdbTools();
  const { mdb, cleanup } = resolveMdb(args);

  try {
    console.log(`Reading tables from ${path.basename(mdb)} …`);
    const { rows, scanned, skippedCat, skippedApt } = await buildRawRows(mdb, {
      onProgress: (n) => process.stdout.write(`\r  aircraft scanned: ${n}`),
    });
    process.stdout.write('\n');

    const dataThrough = rows.reduce((mx, r) => (r.event_date && r.event_date > mx ? r.event_date : mx), '');
    const byAirport = groupByAirport(rows);
    const profiles = [...byAirport.entries()].map(([code, rs]) => buildAirportProfile(code, rs, dataThrough || null));
    const relevantTotal = profiles.reduce((n, p) => n + p.part135_relevant_events, 0);

    console.log('\n=== summary ===');
    console.log(`  aircraft scanned        ${scanned.toLocaleString()}`);
    console.log(`  skipped (not airplane)  ${skippedCat.toLocaleString()}`);
    console.log(`  skipped (no airport)    ${skippedApt.toLocaleString()}`);
    console.log(`  raw airplane rows       ${rows.length.toLocaleString()}`);
    console.log(`  airports profiled       ${profiles.length.toLocaleString()}`);
    console.log(`  Part 135-relevant       ${relevantTotal.toLocaleString()}`);
    console.log(`  data through            ${dataThrough || '(none)'}`);

    if (args.airport) {
      const forms = new Set([args.airport]);
      if (args.airport.length === 4 && args.airport.startsWith('K')) forms.add(args.airport.slice(1));
      const p = profiles.find((x) => forms.has(x.airport_code));
      console.log(`\n=== sample profile for ${args.airport} ===`);
      console.log(p ? JSON.stringify(p, null, 2) : '  (no record at this airport)');
    }

    if (args.dryRun) { console.log('\n--dry-run: nothing written.'); return; }

    const client = getSupabase();
    console.log(`\nUpserting ${rows.length.toLocaleString()} raw rows …`);
    await upsertBatched(client, 'ntsb_raw', rows, 'ntsb_number');
    console.log(`Upserting ${profiles.length.toLocaleString()} airport profiles …`);
    await upsertBatched(client, 'ntsb_airport_profiles', profiles.map((p) => ({ ...p, updated_at: new Date().toISOString() })), 'airport_code');
    console.log('✓ done');
  } finally {
    if (cleanup) cleanup();
  }
}

main().catch((e) => { console.error('\nFATAL:', e?.message || e); process.exit(1); });
