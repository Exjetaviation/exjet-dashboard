// backend/scripts/scansLfPeople.mjs
//
// Download LevelFlight passenger document SCANS (customer.images[]) into the
// private scheduling-docs bucket and index them as person documents, so the
// profile's Documents section shows the actual passport/ID files.
//
// Flow per image: resolve /api/image/{id} -> presigned S3 url -> download bytes
// -> upload to people/{person_id}/lf-{imageId}.{ext} -> insert scheduling_documents.
// Idempotent: skips images already pulled (by image id embedded in storage_path).
//
// Run from backend/:
//   node scripts/scansLfPeople.mjs --dry-run   # report how many scans, NO downloads/writes
//   node scripts/scansLfPeople.mjs             # perform the download + index
import 'dotenv/config';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import { getCustomer, getImageUrl } from '../src/services/levelflight.js';

const DRY = process.argv.includes('--dry-run');
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY)
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const BUCKET = 'scheduling-docs';

const extFor = (ct) => /pdf/.test(ct) ? 'pdf' : /png/.test(ct) ? 'png' : /jpe?g/.test(ct) ? 'jpg' : /tiff?/.test(ct) ? 'tif' : 'bin';
const safe = (s) => String(s || 'LF scan').replace(/[^a-zA-Z0-9._ -]/g, '_').trim().slice(0, 60) || 'LF scan';

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

// People from LF.
const people = await pageAll('scheduling_people', 'id, lf_oid', (q) => q.not('lf_oid', 'is', null));
console.log(`People with lf_oid: ${people.length}`);

// Already-pulled image ids (parsed from existing storage paths) — keep idempotent.
const pulled = new Set();
for (const d of await pageAll('scheduling_documents', 'storage_path', (q) => q.not('person_id', 'is', null))) {
  const m = /lf-([a-f0-9]+)/i.exec(d.storage_path || '');
  if (m) pulled.add(m[1]);
}
console.log(`Already-pulled scans: ${pulled.size}`);

let peopleWithScans = 0, downloaded = 0, skipped = 0, failed = 0;
for (const person of people) {
  let images;
  try { images = (await getCustomer(person.lf_oid))?.customer?.images || []; }
  catch (e) { failed++; if (failed <= 5) console.warn(`detail ${person.lf_oid}: ${e.response?.status || e.message}`); continue; }
  if (!images.length) continue;
  peopleWithScans++;

  for (const img of images) {
    if (!img?.id) continue;
    if (pulled.has(img.id)) { skipped++; continue; }
    if (DRY) { downloaded++; continue; }
    try {
      const url = await getImageUrl(img.id);
      if (!url) { failed++; continue; }
      const resp = await axios.get(url, { responseType: 'arraybuffer' });
      const ct = resp.headers['content-type'] || 'application/octet-stream';
      const buf = Buffer.from(resp.data);
      const path = `people/${person.id}/lf-${img.id}.${extFor(ct)}`;
      const { error: ue } = await sb.storage.from(BUCKET).upload(path, buf, { contentType: ct, upsert: true });
      if (ue) throw ue;
      const { error: ie } = await sb.from('scheduling_documents').insert({
        person_id: person.id, name: `${safe(img.note)}.${extFor(ct)}`, doc_type: 'id',
        storage_path: path, content_type: ct, size_bytes: buf.byteLength,
      });
      if (ie) throw ie;
      pulled.add(img.id); downloaded++;
    } catch (e) { failed++; if (failed <= 5) console.warn(`image ${img.id}: ${e.response?.status || e.message}`); }
  }
}

console.log(`${DRY ? '[dry-run] ' : ''}people with scans ${peopleWithScans}; ${DRY ? 'would download' : 'downloaded'} ${downloaded}; already-have ${skipped}; failures ${failed}.`);
