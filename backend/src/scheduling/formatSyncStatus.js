// backend/src/scheduling/formatSyncStatus.js
//
// Pure: decorate each scheduling_sync_status row with a human freshness label
// derived from its last successful sync time. Used by the sync-status route.
import { freshnessLabel } from './freshness.js';

export function formatSyncStatus(rows, now) {
  return rows.map((r) => ({
    ...r,
    freshness: freshnessLabel(r.last_success_at ?? null, now),
  }));
}
