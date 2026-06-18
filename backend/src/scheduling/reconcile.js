// backend/src/scheduling/reconcile.js
//
// Pure decision logic for the one-way LevelFlight -> mirror sync.
// Given one incoming LevelFlight record and the existing mirror row (or null),
// decide the column values to upsert, protecting any locally-modified copy.
// No I/O — the caller fetches existing rows and performs the upsert.

// Order-independent JSON string, so snapshot comparison ignores key order.
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

export function snapshotsEqual(a, b) {
  return stableStringify(a) === stableStringify(b);
}

// incoming: { lfOid: string, values: object, snapshot: object }
//   values   = working-copy columns derived from LevelFlight
//   snapshot = object frozen for "Revert to LevelFlight"
// existing: null | { locally_modified: boolean, lf_synced_snapshot: object }
// now: ISO timestamp string
// returns: { action: 'insert' | 'update', set: object }  (set is upserted by lf_oid)
export function reconcileRecord(incoming, existing, now) {
  const { lfOid, values, snapshot } = incoming;

  if (!existing) {
    return {
      action: 'insert',
      set: {
        lf_oid: lfOid,
        ...values,
        origin: 'levelflight',
        lf_synced_snapshot: snapshot,
        locally_modified: false,
        upstream_changed: false,
        synced_at: now,
      },
    };
  }

  if (!existing.locally_modified) {
    // Clean mirror: refresh working copy + snapshot.
    return {
      action: 'update',
      set: {
        lf_oid: lfOid,
        ...values,
        lf_synced_snapshot: snapshot,
        upstream_changed: false,
        synced_at: now,
      },
    };
  }

  // Locally modified: never touch the working copy. Refresh the snapshot and
  // flag if LevelFlight changed upstream so the user can review/revert.
  return {
    action: 'update',
    set: {
      lf_oid: lfOid,
      lf_synced_snapshot: snapshot,
      upstream_changed: !snapshotsEqual(existing.lf_synced_snapshot, snapshot),
      synced_at: now,
    },
  };
}
