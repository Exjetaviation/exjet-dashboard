// backend/scripts/backfillPeople.mjs
//
// One-time: create a scheduling_people row per distinct existing passenger and
// link scheduling_passengers.person_id + scheduling_documents.person_id.
// Idempotent: skips passengers that already have a person_id. Re-run-safe: uses
// find-or-create in step 2 so a partial crash doesn't duplicate people. Run from
// backend/:  node scripts/backfillPeople.mjs
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { groupPeople } from '../src/scheduling/peopleBackfill.js';

// m3: Fail fast on missing env vars.
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY)
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// 1. Load ALL unlinked passengers (paginated to avoid 1000-row default truncation).
const pax = [];
let from = 0;
for (;;) {
  const { data, error } = await sb
    .from('scheduling_passengers').select('id, name, dob, weight_lbs')
    .is('person_id', null).range(from, from + 999);
  if (error) throw error;
  if (!data?.length) break;
  pax.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}
console.log(`Unlinked passengers: ${pax.length}`);

const { people, passengerToKey } = groupPeople(pax);
console.log(`Distinct people to create: ${people.length}`);

// 2. Find-or-create each person so a re-run after a partial crash reuses existing
//    rows instead of duplicating them.  Match on origin='native' + identity fields,
//    using .is() for null values and .eq() for non-null.
const keyToId = {};
for (const p of people) {
  // Build a query that matches on first_name, last_name, dob (null-safe).
  let q = sb.from('scheduling_people').select('id').eq('origin', 'native');
  q = p.first_name != null ? q.eq('first_name', p.first_name) : q.is('first_name', null);
  q = p.last_name  != null ? q.eq('last_name',  p.last_name)  : q.is('last_name',  null);
  q = p.dob        != null ? q.eq('dob',        p.dob)        : q.is('dob',        null);
  const { data: existing, error: fe } = await q.maybeSingle();
  if (fe) throw fe;

  if (existing) {
    // Reuse the existing person row — crash-safe idempotency.
    keyToId[p.key] = existing.id;
  } else {
    const { data: inserted, error: ie } = await sb.from('scheduling_people')
      .insert({
        first_name:  p.first_name,
        middle_name: p.middle_name || null,
        last_name:   p.last_name   || null,
        dob:         p.dob,
        weight_lbs:  p.weight_lbs,
        origin:      'native',
      })
      .select('id').single();
    if (ie) throw ie;
    keyToId[p.key] = inserted.id;
  }
}

// 3. Link each passenger row to its person — batched by personId to reduce round-trips.
// m2: Group passenger ids by person, one update per person.
const personToPaxIds = {};
for (const [passengerId, key] of Object.entries(passengerToKey)) {
  const personId = keyToId[key];
  if (!personId) continue;
  (personToPaxIds[personId] ??= []).push(passengerId);
}
for (const [personId, passengerIds] of Object.entries(personToPaxIds)) {
  const { error } = await sb.from('scheduling_passengers')
    .update({ person_id: personId }).in('id', passengerIds);
  if (error) throw error;
}

// 4. Re-point passenger-attached documents to the person (paginated; honest counter).
const docs = [];
let dfrom = 0;
for (;;) {
  const { data, error } = await sb
    .from('scheduling_documents').select('id, passenger_id')
    .not('passenger_id', 'is', null).is('person_id', null)
    .range(dfrom, dfrom + 999);
  if (error) throw error;
  if (!data?.length) break;
  docs.push(...data);
  if (data.length < 1000) break;
  dfrom += 1000;
}

// Resolve each doc's person via its passenger's CURRENT person_id (the source of
// truth after step 3), batched. This handles docs whose passenger was linked in an
// EARLIER run and so isn't in this run's in-memory map — keeping re-runs crash-safe.
const paxIds = [...new Set(docs.map((d) => d.passenger_id))];
const paxPerson = {};
for (let i = 0; i < paxIds.length; i += 1000) {
  const { data, error } = await sb.from('scheduling_passengers')
    .select('id, person_id').in('id', paxIds.slice(i, i + 1000));
  if (error) throw error;
  for (const r of data || []) paxPerson[r.id] = r.person_id;
}

// I1: Count only docs actually re-pointed; warn on any that can't be resolved.
let repointed = 0;
for (const d of docs) {
  const personId = paxPerson[d.passenger_id];
  if (!personId) {
    console.warn(`doc ${d.id}: passenger ${d.passenger_id} has no person_id — skipped`);
    continue;
  }
  const { error } = await sb.from('scheduling_documents')
    .update({ person_id: personId }).eq('id', d.id);
  if (error) throw error;
  repointed++;
}

console.log(
  `Linked ${Object.keys(passengerToKey).length} passengers, ` +
  `re-pointed ${repointed}/${docs.length} documents. Done.`
);
