// backend/src/scheduling/mirrorLegs.js
//
// Pure: shape scheduling_legs rows into the leg-object array the existing
// dashboard list components (FlightsList/TripsList) consume. Each leg is the
// stored LevelFlight snapshot with a _mirror provenance tag attached. Rows
// without a snapshot (e.g. future native-only legs) are dropped.
export function mirrorLegsFromRows(rows) {
  return (rows || [])
    .filter((r) => r && r.lf_synced_snapshot)
    .map((r) => ({
      ...r.lf_synced_snapshot,
      _mirror: {
        origin: r.origin,
        locally_modified: r.locally_modified,
        upstream_changed: r.upstream_changed,
      },
    }));
}
