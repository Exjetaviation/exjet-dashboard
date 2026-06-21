// backend/scripts/enrichLfPeople.mjs
//
// Enrich the passenger directory from LevelFlight customer detail. For every
// scheduling_people row that has an lf_oid, fetch GET /api/customer/{lf_oid} and
// fill DOB (birthday), weight, citizenship, gender, and travel documents
// (passport / green card numbers + expiry) — only fields LF actually provides,
// never clobbering existing data with null.
//
// Run from backend/:
//   node scripts/enrichLfPeople.mjs --dry-run   # fetch + report field coverage, NO writes
//   node scripts/enrichLfPeople.mjs             # perform the enrichment
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { getCustomer } from '../src/services/levelflight.js';

const DRY = process.argv.includes('--dry-run');
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY)
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// LevelFlight document `type` -> our person columns (per /api/customer/documentCodes).
const DOC_TYPE = {
  0: { num: 'passport_number', exp: 'passport_expiry', country: 'passport_country' }, // P  Passport
  1: { num: 'green_card_number', exp: 'green_card_expiry' },                          // C  Permanent Resident Card
};
const toDate = (v) => {
  if (v == null) return null;
  const raw = v?.$date ?? v;
  const ms = typeof raw === 'number' ? raw : Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  if (y < 1900 || y > 2200) return null; // drop LF's corrupt/out-of-range dates
  return d.toISOString().slice(0, 10);
};
const num = (v) => { const n = v == null ? null : Number(v); return Number.isFinite(n) ? n : null; };

// Build a patch of only the fields LF gave us.
function buildPatch(c) {
  const p = {};
  const dob = toDate(c.birthday); if (dob) p.dob = dob;
  const w = num(c.weight); if (w != null) p.weight_lbs = w;
  if (c.citizenship) p.citizenship = c.citizenship;
  if (c.gender) p.gender = c.gender;
  for (const doc of c.documents || []) {
    const map = DOC_TYPE[doc.type];
    if (!map) continue;
    if (doc.number) p[map.num] = String(doc.number);
    if (map.exp) { const e = toDate(doc.expiry); if (e) p[map.exp] = e; }
    if (map.country && doc.country) p[map.country] = doc.country;
  }
  return p;
}

// --- Load all people that came from LF (have an lf_oid), paginated.
const people = [];
let from = 0;
for (;;) {
  const { data, error } = await sb.from('scheduling_people').select('id, lf_oid').not('lf_oid', 'is', null).range(from, from + 999);
  if (error) throw error;
  if (!data?.length) break;
  people.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}
console.log(`People with lf_oid: ${people.length}`);

let fetched = 0, failed = 0, updated = 0, errored = 0;
const cov = { dob: 0, weight_lbs: 0, citizenship: 0, gender: 0, passport_number: 0, green_card_number: 0 };
for (const person of people) {
  let detail;
  try {
    const res = await getCustomer(person.lf_oid);
    detail = res?.customer || res; // endpoint wraps in { success, customer }
    fetched++;
  } catch (e) { failed++; if (failed <= 5) console.warn(`fetch ${person.lf_oid}: ${e.response?.status || e.message}`); continue; }

  const patch = buildPatch(detail || {});
  for (const k of Object.keys(cov)) if (patch[k] != null) cov[k]++;
  if (!Object.keys(patch).length) continue;

  if (DRY) { updated++; continue; }
  try {
    const { error } = await sb.from('scheduling_people').update(patch).eq('id', person.id);
    if (error) throw error;
    updated++;
  } catch (e) {
    errored++;
    if (errored <= 5) console.warn(`update ${person.lf_oid}: ${e.message}`);
  }
}

console.log(`${DRY ? '[dry-run] ' : ''}fetched ${fetched}, failed ${failed}, ${DRY ? 'would update' : 'updated'} ${updated}, errored ${errored}.`);
console.log('field coverage:', Object.entries(cov).map(([k, v]) => `${k}=${v}`).join('  '));
