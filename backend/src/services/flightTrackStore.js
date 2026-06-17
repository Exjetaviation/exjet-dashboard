// backend/src/services/flightTrackStore.js
// Soft-failing persistence for permanent per-flight track snapshots. If Supabase
// isn't configured, every function no-ops (returns null/empty Set) so the
// reconciler and endpoints keep working without it. Same pattern as adsbStore.js.

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

let _client = null;
function getClient() {
  if (_client !== null) return _client || null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) { _client = false; return null; }
  try { _client = createClient(url, key); return _client; }
  catch (e) { console.warn('[flightTrackStore] client init failed (soft):', e.message); _client = false; return null; }
}

// One snapshot row by leg id, or null.
export async function getFlightTrack(legId) {
  const client = getClient();
  if (!client || !legId) return null;
  try {
    const { data, error } = await client
      .from('flight_tracks')
      .select('leg_id, registration, from_airport, to_airport, dep_time, arr_time, track, point_count')
      .eq('leg_id', legId)
      .maybeSingle();
    if (error) { console.warn('[flightTrackStore] get failed (soft):', error.message); return null; }
    return data || null;
  } catch (e) { console.warn('[flightTrackStore] get error (soft):', e?.message || e); return null; }
}

// Which of `legIds` already have a stored snapshot. Returns a Set (empty if
// Supabase off / on any error).
export async function getStoredLegIds(legIds) {
  const ids = (legIds || []).filter(Boolean);
  if (!ids.length) return new Set();
  const client = getClient();
  if (!client) return new Set();
  try {
    const { data, error } = await client
      .from('flight_tracks')
      .select('leg_id')
      .in('leg_id', ids);
    if (error) { console.warn('[flightTrackStore] getStoredLegIds failed (soft):', error.message); return new Set(); }
    return new Set((data || []).map((r) => r.leg_id));
  } catch (e) { console.warn('[flightTrackStore] getStoredLegIds error (soft):', e?.message || e); return new Set(); }
}

// Upsert one snapshot by leg_id. Returns true on success, false/null on soft-fail.
export async function upsertFlightTrack(row) {
  const client = getClient();
  if (!client || !row?.leg_id) return null;
  try {
    const { error } = await client.from('flight_tracks').upsert(row, { onConflict: 'leg_id' });
    if (error) { console.warn('[flightTrackStore] upsert failed (soft):', error.message); return false; }
    return true;
  } catch (e) { console.warn('[flightTrackStore] upsert error (soft):', e?.message || e); return false; }
}
