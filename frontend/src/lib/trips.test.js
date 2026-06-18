// frontend/src/lib/trips.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupLegsIntoTrips } from './trips.js';

const leg = (disp, dep, arr, depTime, arrTime, status = 3) => ({
  _id: { $oid: `${disp}-${depTime}` },
  departure: { airport: dep, time: depTime },
  arrival: { airport: arr, time: arrTime },
  status,
  passengerCount: 2,
  dispatch: { _id: { $oid: disp }, tripId: 25000 + Number(disp), quoteId: 9000, aircraft: { tailNumber: 'N69FP', type: { name: 'GIV' } }, client: { company: { name: 'Acme' } } },
});

test('groups legs by dispatch, orders legs, builds route + range', () => {
  const trips = groupLegsIntoTrips([
    leg('2', 'KMKC', 'KFXE', 400, 500),
    leg('1', 'KFXE', 'KMKC', 100, 200),
    leg('1', 'KMKC', 'KFXE', 300, 400),
  ]);
  assert.equal(trips.length, 2);
  const t1 = trips.find((t) => t.dispatchId === '1');
  assert.equal(t1.legCount, 2);
  assert.deepEqual(t1.legs.map((l) => l.departure.time), [100, 300]); // ordered
  assert.equal(t1.from, 'KFXE');
  assert.equal(t1.to, 'KFXE');
  assert.equal(t1.routeSummary, 'KFXE → KMKC → KFXE');
  assert.equal(t1.start, 100);
  assert.equal(t1.end, 400);
  assert.equal(t1.tail, 'N69FP');
  assert.equal(t1.client, 'Acme');
});

test('sorts trips by end desc (newest first)', () => {
  const trips = groupLegsIntoTrips([leg('1', 'A', 'B', 100, 200), leg('2', 'C', 'D', 900, 1000)]);
  assert.deepEqual(trips.map((t) => t.dispatchId), ['2', '1']);
});

test('status: Completed only when all legs completed', () => {
  const done = groupLegsIntoTrips([leg('1', 'A', 'B', 1, 2, 3), leg('1', 'B', 'A', 3, 4, 3)])[0];
  assert.equal(done.status, 3);
  const mixed = groupLegsIntoTrips([leg('1', 'A', 'B', 1, 2, 3), leg('1', 'B', 'A', 3, 4, 0)])[0];
  assert.equal(mixed.status, 0); // earliest non-completed
});

test('legs without a dispatch id go to the ungrouped bucket, not dropped', () => {
  const orphan = { _id: { $oid: 'x' }, departure: { airport: 'A', time: 5 }, arrival: { airport: 'B', time: 6 }, status: 1 };
  const trips = groupLegsIntoTrips([orphan]);
  assert.equal(trips.length, 1);
  assert.equal(trips[0].dispatchId, 'ungrouped');
  assert.equal(trips[0].legCount, 1);
});
