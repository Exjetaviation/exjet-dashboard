// backend/src/services/legActualsStore.js
// Soft-failing persistence for per-leg ACTUAL departure/arrival times (the calendar
// delay overlay). Keyed by leg_id (the LevelFlight leg oid). If Supabase isn't
// configured — or migration 017 isn't applied — every function no-ops, so the
// recorder/reconciler/endpoint keep working without it. Same pattern as adsbStore.js.

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

// Source precedence: a live recorder reading beats a reconciler-derived one, which
// beats an approximate one. recordLegActual won't downgrade an existing value.
const PRIORITY = { live: 3, exact: 2, approx: 1 };
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

    // Arrival: same rule.
    if (fields.actualArr != null && prio(fields.arrSource) >= prio(cur?.arr_source)) {
      row.actual_arr_time = iso(fields.actualArr); row.arr_source = fields.arrSource;
    } else { row.actual_arr_time = cur?.actual_arr_time ?? null; row.arr_source = cur?.arr_source ?? null; }

    const { error } = await client.from('leg_actuals').upsert(row, { onConflict: 'leg_id' });
    if (error) { console.warn('[legActualsStore] record failed (soft):', error.message); return false; }
    return true;
  } catch (e) { console.warn('[legActualsStore] record error (soft):', e?.message || e); return false; }
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

// Actuals for legs whose SCHEDULED departure falls in [fromIso, toIso]. Rows
// { leg_id, actual_dep_time, actual_arr_time, dep_source, arr_source }. Soft-fails to [].
export async function getLegActualsInRange(fromIso, toIso) {
  const client = getClient();
  if (!client) return [];
  try {
    const { data, error } = await client
      .from('leg_actuals')
      .select('leg_id, actual_dep_time, actual_arr_time, dep_source, arr_source')
      .gte('dep_time', fromIso).lte('dep_time', toIso);
    if (error) { console.warn('[legActualsStore] getInRange failed (soft):', error.message); return []; }
    return data || [];
  } catch (e) { console.warn('[legActualsStore] getInRange error (soft):', e?.message || e); return []; }
}
