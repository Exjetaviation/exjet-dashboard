// backend/src/scheduling/runScheduledLegsSync.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScheduledLegsSync } from './runScheduledLegsSync.js';

const NOW = '2026-06-18T19:00:00.000Z';

const dispatch = {
  _id: { $oid: 'disp1' }, tripId: 25104, status: 'booked',
  aircraft: { _id: { $oid: 'acN69' } },
  client: { company: { _id: { $oid: 'co1' } }, customer: { _id: { $oid: 'cust1' } } },
};
const pilots = [{ seat: 2, user: { _id: { $oid: 'pilotPIC' } } }, { seat: 3, user: { _id: { $oid: 'pilotSIC' } } }];
const legBack = { _id: { $oid: 'legA' }, status: 'booked', dispatch, pilots,
  departure: { airport: 'KFXE', time: 1765207800000 }, arrival: { airport: 'TJSJ', time: 1765222200000 } };
const legOut = { _id: { $oid: 'legB' }, status: 'booked', dispatch, pilots,
  departure: { airport: 'TJSJ', time: 1765290600000 }, arrival: { airport: 'KFXE', time: 1765305000000 } };

function makeFakeDb(seed = {}) {
  const store = {
    scheduling_trips: new Map(), scheduling_legs: new Map(), scheduling_crew_assignments: new Map(),
  };
  for (const [table, rows] of Object.entries(seed)) for (const r of rows) store[table].set(r.lf_oid, r);
  const statusCalls = [];
  let idSeq = 0;
  return {
    store, statusCalls,
    async existingByLfOid(table, oids) {
      const m = new Map();
      for (const oid of oids) {
        const r = store[table].get(oid);
        if (r) m.set(oid, {
          locally_modified: r.locally_modified ?? false,
          lf_synced_snapshot: r.lf_synced_snapshot ?? null,
          upstream_changed: r.upstream_changed ?? false,
        });
      }
      return m;
    },
    async upsert(table, rows) {
      const out = [];
      for (const set of rows) {
        const prev = store[table].get(set.lf_oid);
        const id = prev?.id ?? `${table}#${++idSeq}`;
        store[table].set(set.lf_oid, { ...(prev || {}), ...set, id });
        out.push({ id, lf_oid: set.lf_oid });
      }
      return out;
    },
    async recordSyncStatus(entity, info) { statusCalls.push({ entity, ...info }); },
  };
}

test('runScheduledLegsSync mirrors trips, legs, and crew with resolved FKs', async () => {
  const lf = { async scheduledLegs(start) { return start === 1000 ? [legOut, legBack] : []; } };
  const db = makeFakeDb();

  const counts = await runScheduledLegsSync({ lf, db, now: NOW, monthStarts: [1000, 2000] });

  // 1 trip, 2 legs, and a PIC + SIC on each leg = 4 crew assignments.
  assert.deepEqual(counts, { trips: 1, legs: 2, crew: 4 });
  assert.equal(db.store.scheduling_trips.size, 1);
  assert.equal(db.store.scheduling_legs.size, 2);
  assert.equal(db.store.scheduling_crew_assignments.size, 4);

  // legs got a real trip_id FK
  const legA = db.store.scheduling_legs.get('legA');
  assert.equal(legA.trip_id, db.store.scheduling_trips.get('disp1').id);
  // crew got a real leg_id FK
  const pic = db.store.scheduling_crew_assignments.get('legA:PIC');
  assert.equal(pic.leg_id, legA.id);
  assert.equal(pic.seat, 'PIC');

  // status recorded ok
  assert.equal(db.statusCalls.length, 1);
  assert.equal(db.statusCalls[0].entity, 'scheduledLegs');
  assert.equal(db.statusCalls[0].status, 'ok');
  assert.deepEqual(db.statusCalls[0].counts, { trips: 1, legs: 2, crew: 4 });
});

test('runScheduledLegsSync does not overwrite a locally modified trip', async () => {
  const lf = { async scheduledLegs() { return [legBack]; } };
  const db = makeFakeDb({
    scheduling_trips: [{
      lf_oid: 'disp1', id: 'trip-existing', status: 'quote',
      locally_modified: true, lf_synced_snapshot: { status: 'quote' }, upstream_changed: false,
    }],
  });

  await runScheduledLegsSync({ lf, db, now: NOW, monthStarts: [1000] });

  const trip = db.store.scheduling_trips.get('disp1');
  assert.equal(trip.status, 'quote');           // working copy preserved (not 'booked')
  assert.equal(trip.upstream_changed, true);     // LF changed quote->booked, flagged
});

test('runScheduledLegsSync records an error status and rethrows on fetch failure', async () => {
  const lf = { async scheduledLegs() { throw new Error('LF down'); } };
  const db = makeFakeDb();
  await assert.rejects(() => runScheduledLegsSync({ lf, db, now: NOW, monthStarts: [1000] }), /LF down/);
  assert.equal(db.statusCalls.length, 1);
  assert.equal(db.statusCalls[0].status, 'error');
  assert.match(db.statusCalls[0].message, /LF down/);
});
