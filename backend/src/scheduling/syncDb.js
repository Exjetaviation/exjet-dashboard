// backend/src/scheduling/syncDb.js
//
// Real `db` adapter for the sync orchestrator, over Supabase (service role).
// Fulfills the interface runScheduledLegsSync expects:
//   existingByLfOid(table, lfOids) -> Map<lf_oid, { locally_modified, lf_synced_snapshot, upstream_changed }>
//   upsert(table, rows)            -> Array<{ id, lf_oid }>
//   recordSyncStatus(entity, info) -> void
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

  async upsert(table, rows) {
    if (!rows.length) return [];
    const { data, error } = await supabase
      .from(table)
      .upsert(rows, { onConflict: 'lf_oid' })
      .select('id, lf_oid');
    if (error) throw new Error(`upsert(${table}): ${error.message}`);
    return data || [];
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
