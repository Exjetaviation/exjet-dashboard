// backend/scripts/rehomePassengerDocs.mjs
//
// One-time: move person-attached document files from the old trip-scoped path
// ({trip_id}/...) to the person-scoped path (people/{person_id}/...) and update
// storage_path. Idempotent: skips files already under people/. Run after
// backfillPeople.mjs, from backend/:  node scripts/rehomePassengerDocs.mjs
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// m3: Fail fast on missing env vars.
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY)
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');

const BUCKET = 'scheduling-docs';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// I3: Fail fast if backfillPeople.mjs hasn't run yet.
// Detect documents that still have passenger_id set but person_id null — those
// should have been re-pointed by backfillPeople.mjs.
const { count: pending } = await sb.from('scheduling_documents')
  .select('id', { count: 'exact', head: true })
  .not('passenger_id', 'is', null).is('person_id', null);
if (pending && pending > 0) {
  console.error(
    `${pending} passenger-linked document(s) still have no person_id — run backfillPeople.mjs first.`
  );
  process.exit(1);
}

const { data: docs, error } = await sb
  .from('scheduling_documents').select('id, person_id, storage_path').not('person_id', 'is', null);
if (error) throw error;

let moved = 0;
let failed = 0;  // C2: track move failures
for (const d of docs) {
  if (!d.storage_path || d.storage_path.startsWith('people/')) continue; // already re-homed
  const base = d.storage_path.split('/').pop();
  const dest = `people/${d.person_id}/${base}`;
  const { error: me } = await sb.storage.from(BUCKET).move(d.storage_path, dest);
  if (me) {
    // C2: warn, count failure, skip storage_path update, keep looping.
    console.warn(`move failed for ${d.id}: ${me.message}`);
    failed++;
    continue;
  }
  const { error: ue } = await sb.from('scheduling_documents').update({ storage_path: dest }).eq('id', d.id);
  if (ue) throw ue;
  moved++;
}

// C2: Report both moved and failed counts; exit non-zero if any failed.
console.log(`Re-homed ${moved} file(s). ${failed} failed.`);
if (failed) process.exit(1);
