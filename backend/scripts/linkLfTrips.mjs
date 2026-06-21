// backend/scripts/linkLfTrips.mjs
//
// Transfer the trips each passenger has been on: for every mirrored dispatch,
// read its pax list and create scheduling_passengers rows linking the person
// (matched by lf_oid) to that trip — so profiles show real trip history and the
// trip manifests show who was aboard. Idempotent: skips (trip, person) pairs that
// already exist.
//
// Run from backend/:
//   node scripts/linkLfTrips.mjs --dry-run   # report only, NO writes
//   node scripts/linkLfTrips.mjs             # perform the linking
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { getDispatchRelease } from '../src/services/levelflight.js';

const DRY = process.argv.includes('--dry-run');
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY)
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const pageAll = async (table, cols, tweak) => {
  const out = []; let from = 0;
  for (;;) {
    let q = sb.from(table).select(cols).range(from, from + 999);
    if (tweak) q = tweak(q);
    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
};

// 1. lf_oid -> person id
const peopleByOid = {};
for (const p of await pageAll('scheduling_people', 'id, lf_oid', (q) => q.not('lf_oid', 'is', null))) peopleByOid[p.lf_oid] = p.id;
console.log(`People with lf_oid: ${Object.keys(peopleByOid).length}`);

// 2. mirrored trips (dispatch oid = lf_oid)
const trips = await pageAll('scheduling_trips', 'id, lf_oid', (q) => q.eq('origin', 'levelflight').not('lf_oid', 'is', null));
console.log(`Mirrored trips: ${trips.length}`);

// 3. existing (trip, person) links to stay idempotent
const existing = new Set();
for (const r of await pageAll('scheduling_passengers', 'trip_id, person_id', (q) => q.not('person_id', 'is', null)))
  existing.add(`${r.trip_id}|${r.person_id}`);
console.log(`Existing passenger links: ${existing.size}`);

let linked = 0, dispatchFail = 0, noPerson = 0, alreadyLinked = 0;
for (const trip of trips) {
  let pax;
  try { pax = (await getDispatchRelease(trip.lf_oid))?.pax || []; }
  catch (e) { dispatchFail++; if (dispatchFail <= 5) console.warn(`dispatch ${trip.lf_oid}: ${e.response?.status || e.message}`); continue; }

  for (const px of pax) {
    const oid = px._id?.$oid || px._id;
    const personId = oid && peopleByOid[oid];
    if (!personId) { noPerson++; continue; }
    const key = `${trip.id}|${personId}`;
    if (existing.has(key)) { alreadyLinked++; continue; }
    if (DRY) { linked++; existing.add(key); continue; }
    const { error } = await sb.from('scheduling_passengers').insert({ trip_id: trip.id, person_id: personId, origin: 'levelflight' });
    if (error) { if (linked < 5) console.warn(`link ${key}: ${error.message}`); continue; }
    existing.add(key); linked++;
  }
}

console.log(`${DRY ? '[dry-run] would link' : 'linked'} ${linked}; already-linked ${alreadyLinked}; pax with no matching person ${noPerson}; dispatch fetch failures ${dispatchFail}.`);
