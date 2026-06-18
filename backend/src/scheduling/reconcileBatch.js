// backend/src/scheduling/reconcileBatch.js
//
// Apply reconcileRecord across a page of incoming LevelFlight records.
// Pure: the caller supplies the existing rows (keyed by lf_oid) and performs
// the resulting upserts.
import { reconcileRecord } from './reconcile.js';

// incoming: Array<{ lfOid, values, snapshot }>
// existingByOid: Map<lfOid, existingRow>
// now: ISO timestamp string
// returns: Array<{ action, set }>
export function reconcileBatch(incoming, existingByOid, now) {
  return incoming.map((rec) =>
    reconcileRecord(rec, existingByOid.get(rec.lfOid) ?? null, now)
  );
}
