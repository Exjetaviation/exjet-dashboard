// backend/scripts/importLfPeople.mjs
//
// One-time: import LevelFlight's full customer/passenger directory into
// scheduling_people so the Passengers directory shows EVERYONE, not just the
// passengers that were entered natively in this system.
//
// Idempotent + non-destructive:
//   - upserts by lf_oid (re-runs update, don't duplicate);
//   - reconciles existing native rows by name — promotes a matching native person
//     to origin='levelflight' and attaches its lf_oid, so its trip links survive
//     and nobody is duplicated;
//   - only fills fields that LF provides (never clobbers existing data with null).
//
// Run from backend/:
//   node scripts/importLfPeople.mjs --dry-run   # fetch + report only, NO writes
//   node scripts/importLfPeople.mjs             # perform the import
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { getCustomersByLetter } from '../src/services/levelflight.js';

const DRY = process.argv.includes('--dry-run');
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY)
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];
const PAGE_SIZE = 25;

// --- 1. Pull every LF customer (raw records — keep oid, name parts, extra fields).
const customers = [];
const seen = new Set();
for (const letter of LETTERS) {
  for (let page = 1; page <= 40; page++) {
    let arr;
    try {
      const d = await getCustomersByLetter(letter, page);
      arr = Array.isArray(d) ? d : (d?.results || d?.customers || d?.data || d?.list || []);
    } catch (e) { console.warn(`letter ${letter} p${page}: ${e.message}`); break; }
    if (!arr.length) break;
    for (const c of arr) {
      const oid = c._id?.$oid || c._id || null;
      if (oid && seen.has(oid)) continue;
      if (oid) seen.add(oid);
      customers.push(c);
    }
    if (arr.length < PAGE_SIZE) break; // last page for this letter
  }
}
console.log(`Fetched ${customers.length} LF customers.`);
if (customers.length) console.log('Sample record field names:', Object.keys(customers[0]).sort().join(', '));

// --- 2. Map a raw LF customer -> scheduling_people row (defensive field picking).
const pick = (c, ...keys) => { for (const k of keys) if (c[k] != null && c[k] !== '') return c[k]; return null; };
const toDateStr = (v) => {
  if (v == null) return null;
  const raw = v?.$date ?? v; // EJSON {$date} or plain
  const ms = typeof raw === 'number' ? raw : Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
};
const num = (v) => { const n = v == null ? null : Number(v); return Number.isFinite(n) ? n : null; };
function mapPerson(c) {
  return {
    lf_oid: c._id?.$oid || c._id || null,
    first_name: (c.firstName || '').trim() || null,
    middle_name: (c.middleName || '').trim() || null,
    last_name: (c.lastName || '').trim() || null,
    email: pick(c, 'email'),
    phone: pick(c, 'phone', 'phoneNumber', 'mobile'),
    dob: toDateStr(pick(c, 'dob', 'dateOfBirth', 'birthDate')),
    weight_lbs: num(pick(c, 'weight', 'weightLbs')),
    passport_number: pick(c, 'passportNumber', 'passport'),
    passport_expiry: toDateStr(pick(c, 'passportExpiry', 'passportExpiration')),
    known_traveler_number: pick(c, 'knownTravelerNumber', 'ktn'),
    redress_number: pick(c, 'redressNumber', 'redress'),
    origin: 'levelflight',
  };
}

// --- 3. Upsert each, reconciling native rows by name.
let inserted = 0, updatedByOid = 0, promotedByName = 0, skippedNoName = 0;
for (const c of customers) {
  const p = mapPerson(c);
  if (!p.first_name && !p.last_name) { skippedNoName++; continue; }

  let existing = null;
  if (p.lf_oid) {
    const { data } = await sb.from('scheduling_people').select('id').eq('lf_oid', p.lf_oid).maybeSingle();
    if (data) { existing = data; updatedByOid++; }
  }
  if (!existing) { // match a native (lf_oid null) row by name → promote it
    let q = sb.from('scheduling_people').select('id').is('lf_oid', null);
    q = p.first_name ? q.eq('first_name', p.first_name) : q.is('first_name', null);
    q = p.last_name ? q.eq('last_name', p.last_name) : q.is('last_name', null);
    const { data } = await q.limit(1).maybeSingle();
    if (data) { existing = data; promotedByName++; }
  }

  if (DRY) { if (!existing) inserted++; continue; }

  if (existing) {
    // Only set fields LF actually provided — never overwrite existing data with null.
    const patch = Object.fromEntries(Object.entries(p).filter(([, v]) => v != null));
    const { error } = await sb.from('scheduling_people').update(patch).eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await sb.from('scheduling_people').insert(p);
    if (error) throw error;
    inserted++;
  }
}

console.log(
  `${DRY ? '[dry-run] would: ' : ''}insert ${inserted}, update-by-oid ${updatedByOid}, ` +
  `promote-by-name ${promotedByName}, skipped(no name) ${skippedNoName}. Done.`
);
