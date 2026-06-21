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

// Permanent snapshots for the given leg ids, as a Map(leg_id -> row). One query;
// works for snapshots of ANY age (the raw firehose is pruned at 14 days, these are
// kept forever), so it backs the long-range previous-flights history.
export async function getFlightTracksByLegIds(legIds) {
  const ids = (legIds || []).filter(Boolean);
  if (!ids.length) return new Map();
  const client = getClient();
  if (!client) return new Map();
  try {
    const { data, error } = await client
      .from('flight_tracks')
      .select('leg_id, from_airport, to_airport, dep_time, arr_time, track')
      .in('leg_id', ids);
    if (error) { console.warn('[flightTrackStore] getByLegIds failed (soft):', error.message); return new Map(); }
    return new Map((data || []).map((r) => [r.leg_id, r]));
  } catch (e) { console.warn('[flightTrackStore] getByLegIds error (soft):', e?.message || e); return new Map(); }
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

// Update just the actual dep/arr columns for an existing snapshot row. Deliberately
// DECOUPLED from upsertFlightTrack: if migration 016 (the actual_* columns) hasn't
// been applied yet, this soft-fails on its own while track recording stays intact.
export async function updateFlightTrackActuals(legId, actualDepIso, actualArrIso) {
  const client = getClient();
  if (!client || !legId) return null;
  if (actualDepIso == null && actualArrIso == null) return null; // nothing to record
  try {
    const { error } = await client
      .from('flight_tracks')
      .update({ actual_dep_time: actualDepIso ?? null, actual_arr_time: actualArrIso ?? null })
      .eq('leg_id', legId);
    if (error) { console.warn('[flightTrackStore] updateActuals failed (soft):', error.message); return false; }
    return true;
  } catch (e) { console.warn('[flightTrackStore] updateActuals error (soft):', e?.message || e); return false; }
}

// Stored snapshots since `fromIso` that have NO recorded actuals yet — for a bounded
// one-time backfill over the firehose window. Rows { leg_id, registration, dep_time,
// arr_time }; soft-fails to [].
export async function getRowsMissingActuals(fromIso) {
  const client = getClient();
  if (!client) return [];
  try {
    const { data, error } = await client
      .from('flight_tracks')
      .select('leg_id, registration, dep_time, arr_time')
      .gte('dep_time', fromIso)
      .is('actual_dep_time', null)
      .is('actual_arr_time', null);
    if (error) { console.warn('[flightTrackStore] getRowsMissingActuals failed (soft):', error.message); return []; }
    return data || [];
  } catch (e) { console.warn('[flightTrackStore] getRowsMissingActuals error (soft):', e?.message || e); return []; }
}

// Actual dep/arr for completed legs whose SCHEDULED departure falls in [fromIso, toIso]
// and that have at least one recorded actual. Rows { leg_id, actual_dep_time,
// actual_arr_time }; soft-fails to []. Backs GET /api/adsb/actuals.
export async function getActualsInRange(fromIso, toIso) {
  const client = getClient();
  if (!client) return [];
  try {
    const { data, error } = await client
      .from('flight_tracks')
      .select('leg_id, actual_dep_time, actual_arr_time')
      .gte('dep_time', fromIso).lte('dep_time', toIso)
      .or('actual_dep_time.not.is.null,actual_arr_time.not.is.null');
    if (error) { console.warn('[flightTrackStore] getActualsInRange failed (soft):', error.message); return []; }
    return data || [];
  } catch (e) { console.warn('[flightTrackStore] getActualsInRange error (soft):', e?.message || e); return []; }
}
