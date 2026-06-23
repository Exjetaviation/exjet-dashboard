// backend/src/services/tripCrewStore.js
// Soft-failing read of a dispatch's leg snapshots from the scheduling mirror
// (scheduling_trips -> scheduling_legs.lf_synced_snapshot). Used to derive crew.
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

let _client = null;
function getClient() {
  if (_client !== null) return _client || null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) { _client = false; return null; }
  try { _client = createClient(url, key); return _client; }
  catch (e) { console.warn('[tripCrewStore] init failed (soft):', e.message); _client = false; return null; }
}

// Leg snapshots for a trip (each carries pilots/attendants). Resolves the dispatch
// oid to its trip number, then aggregates legs across ALL dispatch rows sharing that
// number — a trip number can map to several dispatch oids. [] on soft-fail.
export async function getTripLegSnapshots(dispatchOid) {
  const client = getClient();
  if (!client || !dispatchOid) return [];
  try {
    const { data: trip, error: te } = await client
      .from('scheduling_trips').select('trip_number').eq('lf_oid', dispatchOid).maybeSingle();
    if (te || !trip || !trip.trip_number) return [];
    const { data: trips, error: tse } = await client
      .from('scheduling_trips').select('id').eq('trip_number', trip.trip_number);
    if (tse || !trips?.length) return [];
    const ids = trips.map((t) => t.id);
    const { data: legs, error: le } = await client
      .from('scheduling_legs').select('lf_synced_snapshot').in('trip_id', ids);
    if (le) { console.warn('[tripCrewStore] legs (soft):', le.message); return []; }
    return (legs || []).map((l) => l.lf_synced_snapshot).filter(Boolean);
  } catch (e) { console.warn('[tripCrewStore] getTripLegSnapshots (soft):', e?.message || e); return []; }
}

// Booked trips (have a trip number) first mirrored at/after `sinceIso`, as
// [{ oid: lf_oid, tripId: trip_number }]. The `since` cutoff keeps the watcher
// from back-provisioning the historical backlog. [] on soft-fail or no cutoff.
export async function getCandidateTrips(sinceIso) {
  const client = getClient();
  if (!client || !sinceIso) return [];
  try {
    const { data, error } = await client
      .from('scheduling_trips')
      .select('lf_oid, trip_number, created_at')
      .not('trip_number', 'is', null)
      .gte('created_at', sinceIso);
    if (error) { console.warn('[tripCrewStore] getCandidateTrips (soft):', error.message); return []; }
    return (data || [])
      .filter((r) => r.lf_oid && r.trip_number)
      .map((r) => ({ oid: r.lf_oid, tripId: String(r.trip_number) }));
  } catch (e) { console.warn('[tripCrewStore] getCandidateTrips (soft):', e?.message || e); return []; }
}
