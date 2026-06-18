// backend/src/scheduling/syncDb.js
//
// Real `db` adapter for the sync orchestrator, over Supabase (service role).
// Fulfills the interface runScheduledLegsSync expects:
//   existingByLfOid(table, lfOids) -> Map<lf_oid, { locally_modified, lf_synced_snapshot, upstream_changed }>
//   insertRows(table, rows)        -> Array<{ id, lf_oid }>   (brand-new rows)
//   updateByLfOid(table, set)      -> { id, lf_oid }          (one existing row)
//   recordSyncStatus(entity, info) -> void
//
// IMPORTANT — why insert and update are separate (not one bulk upsert):
// a single PostgREST upsert of a heterogeneous batch unions the keys across all
// rows and NULL-fills the missing ones on conflict. A locally-modified row
// deliberately omits its working-copy columns to protect them, so a sibling row
// in the same batch would NULL those columns (and crash on NOT NULL columns like
// legs.trip_id). Per-row .update(patch).eq('lf_oid') touches ONLY the named
// columns, which is what preserves locally-modified working copies.
import { supabase } from '../services/supabase.js';

export const syncDb = {
  async existingByLfOid(table, lfOids) {
    const m = new Map();
    if (!lfOids.length) return m;
    const { data, error } = await supabase
      .from(table)
      .select('lf_oid, locally_modified, lf_synced_snapshot, upstream_changed')
      .in('lf_oid', lfOids);
    if (error) throw new Error(`existingByLfOid(${table}): ${error.message}`);
    for (const r of data || []) m.set(r.lf_oid, r);
    return m;
  },

  // Brand-new rows only — homogeneous full column sets, safe to bulk-insert.
  async insertRows(table, rows) {
    if (!rows.length) return [];
    const { data, error } = await supabase
      .from(table)
      .insert(rows)
      .select('id, lf_oid');
    if (error) throw new Error(`insert(${table}): ${error.message}`);
    return data || [];
  },

  // Update one existing row by lf_oid, touching ONLY the columns in `set`.
  async updateByLfOid(table, set) {
    const { lf_oid, ...patch } = set;
    const { data, error } = await supabase
      .from(table)
      .update(patch)
      .eq('lf_oid', lf_oid)
      .select('id, lf_oid')
      .single();
    if (error) throw new Error(`update(${table}, ${lf_oid}): ${error.message}`);
    return data;
  },

  async recordSyncStatus(entity, { status, message, counts, now }) {
    const row = { entity, last_run_at: now, status, message, counts };
    if (status === 'ok') row.last_success_at = now;
    const { error } = await supabase
      .from('scheduling_sync_status')
      .upsert(row, { onConflict: 'entity' });
    if (error) throw new Error(`recordSyncStatus: ${error.message}`);
  },
};
