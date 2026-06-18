// backend/src/scheduling/mirrorLegs.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mirrorLegsFromRows } from './mirrorLegs.js';

test('mirrorLegsFromRows returns snapshots tagged with mirror provenance', () => {
  const rows = [
    {
      lf_synced_snapshot: { departure: { airport: 'KFXE' }, status: 2, dispatch: { tripId: 25104 } },
      origin: 'levelflight', locally_modified: false, upstream_changed: false,
    },
  ];
  const legs = mirrorLegsFromRows(rows);
  assert.equal(legs.length, 1);
  assert.equal(legs[0].departure.airport, 'KFXE');
  assert.equal(legs[0].status, 2);
  assert.equal(legs[0].dispatch.tripId, 25104);
  assert.deepEqual(legs[0]._mirror, { origin: 'levelflight', locally_modified: false, upstream_changed: false });
});

test('mirrorLegsFromRows drops rows without a snapshot and handles nullish input', () => {
  assert.deepEqual(mirrorLegsFromRows([{ lf_synced_snapshot: null, origin: 'native' }]), []);
  assert.deepEqual(mirrorLegsFromRows([]), []);
  assert.deepEqual(mirrorLegsFromRows(null), []);
});
