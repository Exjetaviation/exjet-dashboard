// backend/src/scheduling/lfEnrich.js
//
// Keep the passenger directory current from LevelFlight, incrementally, from the
// recurring sync. Three cheap operations the worker runs each tick (best-effort):
//   - importNewPeople: insert LF customers we don't have yet (hourly-gated).
//   - enrichPeopleBatch: pull full detail (DOB/weight/docs) + scans for a BOUNDED
//     batch of not-yet-synced people, stamping lf_detail_synced_at.
//   - linkRecentTripPax: link pax to recently-mirrored trips (person<->trip rows).
//
// The one-time scripts (importLfPeople / enrichLfPeople / scansLfPeople /
// linkLfTrips) do the bulk catch-up; this keeps it fresh thereafter. Pure mapping
// lives in lfEnrichMap.js (unit-tested).
import axios from 'axios';
import { supabase } from '../services/supabase.js';
import * as lf from '../services/levelflight.js';
import { mapDetailToPatch, mapListToPerson, extFor, safeDocName } from './lfEnrichMap.js';

const DOC_BUCKET = 'scheduling-docs';

// --- Insert LF customers we don't yet have (matched by lf_oid). Returns count.
export async function importNewPeople() {
  const customers = await lf.getAllCustomersRaw();
  const oids = customers.map((c) => c._id?.$oid || c._id).filter(Boolean);
  const have = new Set();
  for (let i = 0; i < oids.length; i += 500) {
    const { data } = await supabase.from('scheduling_people').select('lf_oid').in('lf_oid', oids.slice(i, i + 500));
    for (const r of data || []) have.add(r.lf_oid);
  }
  const rows = customers.filter((c) => { const o = c._id?.$oid || c._id; return o && !have.has(o); }).map(mapListToPerson).filter(Boolean);
  let imported = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from('scheduling_people').insert(rows.slice(i, i + 200));
    if (!error) imported += Math.min(200, rows.length - i);
  }
  return imported;
}

// --- Enrich a bounded batch of not-yet-synced LF people (detail + scans).
export async function enrichPeopleBatch({ limit = 25 } = {}) {
  const { data: batch } = await supabase
    .from('scheduling_people').select('id, lf_oid')
    .not('lf_oid', 'is', null).is('lf_detail_synced_at', null).limit(limit);
  let enriched = 0, scans = 0;
  for (const person of batch || []) {
    let detail;
    try { detail = (await lf.getCustomer(person.lf_oid))?.customer; }
    catch { continue; } // leave lf_detail_synced_at null -> retried next tick
    const patch = mapDetailToPatch(detail);
    patch.lf_detail_synced_at = new Date().toISOString();
    const { error } = await supabase.from('scheduling_people').update(patch).eq('id', person.id);
    if (error) continue;
    if (Object.keys(patch).length > 1) enriched++;
    scans += await pullScans(person.id, detail?.images || []).catch(() => 0);
  }
  return { enriched, scans };
}

// Download a person's document scans into the bucket, skipping ones already pulled.
async function pullScans(personId, images) {
  if (!images.length) return 0;
  const { data: existing } = await supabase.from('scheduling_documents').select('storage_path').eq('person_id', personId);
  const pulled = new Set((existing || []).map((d) => /lf-([a-f0-9]+)/i.exec(d.storage_path || '')?.[1]).filter(Boolean));
  let n = 0;
  for (const img of images) {
    if (!img?.id || pulled.has(img.id)) continue;
    try {
      const url = await lf.getImageUrl(img.id);
      if (!url) continue;
      const resp = await axios.get(url, { responseType: 'arraybuffer' });
      const ct = resp.headers['content-type'] || 'application/octet-stream';
      const buf = Buffer.from(resp.data);
      const path = `people/${personId}/lf-${img.id}.${extFor(ct)}`;
      const { error: ue } = await supabase.storage.from(DOC_BUCKET).upload(path, buf, { contentType: ct, upsert: true });
      if (ue) continue;
      await supabase.from('scheduling_documents').insert({
        person_id: personId, name: `${safeDocName(img.note)}.${extFor(ct)}`, doc_type: 'id',
        storage_path: path, content_type: ct, size_bytes: buf.byteLength,
      });
      n++;
    } catch { /* best-effort */ }
  }
  return n;
}

// --- Link pax to recently-updated mirrored trips. Bounded to the most recent
// `tripLimit` mirrored trips so a tick stays cheap.
export async function linkRecentTripPax({ tripLimit = 30 } = {}) {
  const { data: trips } = await supabase
    .from('scheduling_trips').select('id, lf_oid').eq('origin', 'levelflight').not('lf_oid', 'is', null)
    .order('updated_at', { ascending: false }).limit(tripLimit);
  if (!trips?.length) return 0;
  const tripIds = trips.map((t) => t.id);
  const { data: peopleRows } = await supabase.from('scheduling_people').select('id, lf_oid').not('lf_oid', 'is', null);
  const personByOid = Object.fromEntries((peopleRows || []).map((p) => [p.lf_oid, p.id]));
  const { data: existing } = await supabase.from('scheduling_passengers').select('trip_id, person_id').in('trip_id', tripIds);
  const have = new Set((existing || []).map((r) => `${r.trip_id}|${r.person_id}`));
  let linked = 0;
  for (const trip of trips) {
    let pax;
    try { pax = (await lf.getDispatchRelease(trip.lf_oid))?.pax || []; } catch { continue; }
    for (const px of pax) {
      const personId = personByOid[px._id?.$oid || px._id];
      if (!personId) continue;
      const key = `${trip.id}|${personId}`;
      if (have.has(key)) continue;
      const { error } = await supabase.from('scheduling_passengers').insert({ trip_id: trip.id, person_id: personId, origin: 'levelflight' });
      if (!error) { have.add(key); linked++; }
    }
  }
  return linked;
}

// --- Orchestrate the incremental directory sync for one worker tick.
let lastImportAt = 0;
export async function syncLfDirectory({ now = Date.now(), enrichLimit = 25, importEveryMs = 3_600_000 } = {}) {
  const out = { imported: 0, enriched: 0, scans: 0, linked: 0 };
  if (now - lastImportAt >= importEveryMs) { out.imported = await importNewPeople(); lastImportAt = now; }
  const e = await enrichPeopleBatch({ limit: enrichLimit }); out.enriched = e.enriched; out.scans = e.scans;
  out.linked = await linkRecentTripPax();
  return out;
}
