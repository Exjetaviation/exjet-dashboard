// backend/src/services/tripCrewStore.js
// Soft-failing read of a dispatch's leg snapshots from the scheduling mirror
// (scheduling_trips -> scheduling_legs.snapshot). Used to derive crew.
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

// Leg snapshots for a dispatch oid (each carries pilots/attendants). [] on soft-fail
// or if the trip hasn't been mirrored yet.
export async function getTripLegSnapshots(dispatchOid) {
  const client = getClient();
  if (!client || !dispatchOid) return [];
  try {
    const { data: trip, error: te } = await client
      .from('scheduling_trips').select('id').eq('lf_oid', dispatchOid).maybeSingle();
    if (te || !trip) return [];
    const { data: legs, error: le } = await client
      .from('scheduling_legs').select('snapshot').eq('trip_id', trip.id);
    if (le) { console.warn('[tripCrewStore] legs (soft):', le.message); return []; }
    return (legs || []).map((l) => l.snapshot).filter(Boolean);
  } catch (e) { console.warn('[tripCrewStore] getTripLegSnapshots (soft):', e?.message || e); return []; }
}
