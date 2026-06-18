// backend/src/scheduling/runScheduledLegsSync.js
//
// Orchestrates one sync pass of LevelFlight scheduled legs into the mirror.
// Dependency-injected (lf + db adapters) so it is fully unit-testable; the real
// adapters and the setInterval worker live in the next plan.
//
// Flow: fetch each month bucket -> map -> upsert trips -> resolve leg.trip_id ->
// upsert legs -> resolve crew.leg_id -> upsert crew -> record sync status.
// Upserts run parent-before-child so foreign keys always resolve, and each entity
// goes through reconcileBatch so locally-modified rows are never overwritten.
import { reconcileBatch } from './reconcileBatch.js';
import { mapScheduledLegs } from './mapScheduledLegs.js';
import { attachFk } from './attachFk.js';

function uniqueByLfOid(records) {
  const m = new Map();
  for (const r of records) if (!m.has(r.lfOid)) m.set(r.lfOid, r);
  return [...m.values()];
}

// Reconcile a page of incoming records against existing mirror rows and upsert
// the results. Returns Map<lfOid, uuid> for the rows now in the table.
async function syncEntity(db, table, incoming, now) {
  if (incoming.length === 0) return new Map();
  const existing = await db.existingByLfOid(table, incoming.map((r) => r.lfOid));
  const ops = reconcileBatch(incoming, existing, now);
  const upserted = await db.upsert(table, ops.map((op) => op.set));
  const idByLfOid = new Map();
  for (const row of upserted) idByLfOid.set(row.lf_oid, row.id);
  return idByLfOid;
}

export async function runScheduledLegsSync({ lf, db, now, monthStarts }) {
  try {
    const rawLegs = [];
    for (const start of monthStarts) {
      const page = await lf.scheduledLegs(start);
      if (Array.isArray(page)) rawLegs.push(...page);
    }

    const mapped = mapScheduledLegs(rawLegs);
    const trips = uniqueByLfOid(mapped.trips);
    const legs = uniqueByLfOid(mapped.legs);
    const crew = uniqueByLfOid(mapped.crew);

    const tripIdByLfOid = await syncEntity(db, 'scheduling_trips', trips, now);

    const legsWithFk = attachFk(legs, 'trip_id', (r) => r.ref.tripLfOid, tripIdByLfOid);
    const legIdByLfOid = await syncEntity(db, 'scheduling_legs', legsWithFk, now);

    const crewWithFk = attachFk(crew, 'leg_id', (r) => r.ref.legLfOid, legIdByLfOid);
    await syncEntity(db, 'scheduling_crew_assignments', crewWithFk, now);

    const counts = { trips: trips.length, legs: legsWithFk.length, crew: crewWithFk.length };
    await db.recordSyncStatus('scheduledLegs', { status: 'ok', message: null, counts, now });
    return counts;
  } catch (e) {
    const message = e && e.message ? e.message : String(e);
    await db.recordSyncStatus('scheduledLegs', { status: 'error', message, counts: null, now });
    throw e;
  }
}
