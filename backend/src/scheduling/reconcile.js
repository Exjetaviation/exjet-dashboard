// backend/src/scheduling/reconcile.js
//
// Pure decision logic for the one-way LevelFlight -> mirror sync.
// Given one incoming LevelFlight record and the existing mirror row (or null),
// decide the column values to upsert, protecting any locally-modified copy.
// No I/O — the caller fetches existing rows and performs the upsert.

// Order-independent JSON string, so snapshot comparison ignores key order.
// Note: undefined and null both serialize to 'null'. LevelFlight snapshots come
// from parsed JSON (which has no undefined), so this is safe for comparison.
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
        // lf_oid after ...values so an incoming key can never clobber it.
        ...values,
        lf_oid: lfOid,
        origin: 'levelflight',
        lf_synced_snapshot: snapshot,
        locally_modified: false,
        upstream_changed: false,
        synced_at: now,
      },
    };
  }

  if (!existing.locally_modified) {
    // Clean mirror: refresh working copy + snapshot. locally_modified is already
    // false here (guarded above); a partial upsert leaves it untouched, so we
    // don't restate it. lf_oid goes after ...values so it can't be clobbered.
    return {
      action: 'update',
      set: {
        ...values,
        lf_oid: lfOid,
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
