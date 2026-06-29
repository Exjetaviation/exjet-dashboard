// backend/src/services/legActualsStore.js
// Soft-failing persistence for per-leg ACTUAL departure/arrival times (the calendar
// delay overlay). Keyed by leg_id (the LevelFlight leg oid). If Supabase isn't
// configured — or migration 017 isn't applied — every function no-ops, so the
// recorder/reconciler/endpoint keep working without it. Same pattern as adsbStore.js.

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

// Source precedence: pilot-entered block times (crew) are authoritative and win over
// everything; then a live recorder reading, a reconciler-derived exact transition, and
// finally an approximate one. recordLegActual won't downgrade an existing value.
const PRIORITY = { crew: 4, live: 3, exact: 2, approx: 1 };
const prio = (s) => PRIORITY[s] || 0;

let _client = null;
function getClient() {
  if (_client !== null) return _client || null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) { _client = false; return null; }
  try { _client = createClient(url, key); return _client; }
  catch (e) { console.warn('[legActualsStore] client init failed (soft):', e.message); _client = false; return null; }
}

const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());

// Upsert actual dep and/or arr for a leg, honoring source precedence per field (never
// downgrades a higher-priority value already stored). `fields`: { registration,
// scheduledDep (ms), actualDep (ms), depSource, actualArr (ms), arrSource }.
export async function recordLegActual(legId, fields = {}) {
  const client = getClient();
  if (!client || !legId) return null;
  try {
    const { data: cur } = await client
      .from('leg_actuals')
      .select('dep_time, actual_dep_time, dep_source, actual_arr_time, arr_source')
      .eq('leg_id', legId)
      .maybeSingle();

    const row = { leg_id: legId, updated_at: new Date().toISOString() };
    if (fields.registration) row.registration = fields.registration;
    row.dep_time = iso(fields.scheduledDep) ?? cur?.dep_time ?? null;

    // Departure: take the new value only if its source is >= the stored one.
    if (fields.actualDep != null && prio(fields.depSource) >= prio(cur?.dep_source)) {
      row.actual_dep_time = iso(fields.actualDep); row.dep_source = fields.depSource;
    } else { row.actual_dep_time = cur?.actual_dep_time ?? null; row.dep_source = cur?.dep_source ?? null; }

    // Arrival: same priority rule, PLUS a coherence guard — an arrival is only valid
    // if the leg has a departure (incoming-or-stored) and arrives AFTER it. This
    // rejects corrupt writes (arr before dep, or arr with no dep) at the source.
    const effDepMs = row.actual_dep_time != null ? Date.parse(row.actual_dep_time) : null;
    const arrCoherent = fields.actualArr != null && effDepMs != null && fields.actualArr > effDepMs;
    if (arrCoherent && prio(fields.arrSource) >= prio(cur?.arr_source)) {
      row.actual_arr_time = iso(fields.actualArr); row.arr_source = fields.arrSource;
    } else { row.actual_arr_time = cur?.actual_arr_time ?? null; row.arr_source = cur?.arr_source ?? null; }

    const { error } = await client.from('leg_actuals').upsert(row, { onConflict: 'leg_id' });
    if (error) { console.warn('[legActualsStore] record failed (soft):', error.message); return false; }
    return true;
  } catch (e) { console.warn('[legActualsStore] record error (soft):', e?.message || e); return false; }
}

// Manual diversion mark: the leg landed at `divertedToIcao` (not its scheduled arrival).
// Single-row upsert on leg_id (preserves other fields). Optional `actualArr` sets the
// landing time at source 'crew' (authoritative). Soft-fails (e.g. until migration 023 is
// applied the `actual_arr_icao`/`divert_*` columns don't exist and the upsert errors).
export async function recordDivert(legId, { divertedToIcao, note = null, status = 'diverted', actualArr = null, scheduledDep = null, registration = null } = {}) {
  const client = getClient();
  if (!client || !legId) return null;
  try {
    const row = {
      leg_id: legId, updated_at: new Date().toISOString(),
      actual_arr_icao: divertedToIcao || null, divert_note: note ?? null, divert_status: status ?? 'diverted',
    };
    if (scheduledDep != null) row.dep_time = iso(scheduledDep);
    if (registration) row.registration = registration;
    if (actualArr != null) { row.actual_arr_time = iso(actualArr); row.arr_source = 'crew'; }
    const { error } = await client.from('leg_actuals').upsert(row, { onConflict: 'leg_id' });
    if (error) { console.warn('[legActualsStore] recordDivert failed (soft):', error.message); return false; }
    return true;
  } catch (e) { console.warn('[legActualsStore] recordDivert error (soft):', e?.message || e); return false; }
}

// Remove a diversion mark from a leg (nulls the divert columns). No-op if the row or
// columns don't exist. Soft-fails.
export async function clearDivert(legId) {
  const client = getClient();
  if (!client || !legId) return null;
  try {
    const { error } = await client.from('leg_actuals')
      .update({ actual_arr_icao: null, divert_note: null, divert_status: null, updated_at: new Date().toISOString() })
      .eq('leg_id', legId);
    if (error) { console.warn('[legActualsStore] clearDivert failed (soft):', error.message); return false; }
    return true;
  } catch (e) { console.warn('[legActualsStore] clearDivert error (soft):', e?.message || e); return false; }
}

// Which of `legIds` already have a stored row. Set (empty on soft-fail). Lets the
// backfill skip legs the live recorder already captured.
export async function getLegIdsWithActuals(legIds) {
  const ids = (legIds || []).filter(Boolean);
  if (!ids.length) return new Set();
  const client = getClient();
  if (!client) return new Set();
  try {
    const { data, error } = await client.from('leg_actuals').select('leg_id').in('leg_id', ids);
    if (error) { console.warn('[legActualsStore] getIds failed (soft):', error.message); return new Set(); }
    return new Set((data || []).map((r) => r.leg_id));
  } catch (e) { console.warn('[legActualsStore] getIds error (soft):', e?.message || e); return new Set(); }
}

// Map(legId -> { dep, arr } ms) of stored actuals for `legIds`. Lets matchActiveLeg
// decide which legs are truly completed (coherentArrival needs both dep and arr).
// Empty Map on soft-fail.
export async function getActualsByLeg(legIds) {
  const ids = (legIds || []).filter(Boolean);
  if (!ids.length) return new Map();
  const client = getClient();
  if (!client) return new Map();
  try {
    const { data, error } = await client
      .from('leg_actuals')
      .select('leg_id, actual_dep_time, actual_arr_time')
      .in('leg_id', ids);
    if (error) { console.warn('[legActualsStore] getActuals failed (soft):', error.message); return new Map(); }
    const m = new Map();
    for (const r of data || []) {
      m.set(r.leg_id, {
        dep: r.actual_dep_time ? Date.parse(r.actual_dep_time) : null,
        arr: r.actual_arr_time ? Date.parse(r.actual_arr_time) : null,
      });
    }
    return m;
  } catch (e) { console.warn('[legActualsStore] getActuals error (soft):', e?.message || e); return new Map(); }
}

// Actuals for legs whose SCHEDULED departure falls in [fromIso, toIso]. Rows include
// actual dep/arr + sources, plus divert fields (actual_arr_icao/divert_note/divert_status)
// when migration 023 is applied. `select('*')` so it works both before AND after 023
// (selecting a not-yet-created column would error the whole query). Soft-fails to [].
export async function getLegActualsInRange(fromIso, toIso) {
  const client = getClient();
  if (!client) return [];
  try {
    const { data, error } = await client
      .from('leg_actuals')
      .select('*')
      .gte('dep_time', fromIso).lte('dep_time', toIso);
    if (error) { console.warn('[legActualsStore] getInRange failed (soft):', error.message); return []; }
    return data || [];
  } catch (e) { console.warn('[legActualsStore] getInRange error (soft):', e?.message || e); return []; }
}
