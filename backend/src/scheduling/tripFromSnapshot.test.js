// backend/src/scheduling/tripFromSnapshot.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tripColumnsFromSnapshot } from './tripFromSnapshot.js';

test('tripColumnsFromSnapshot rebuilds trip columns from a dispatch snapshot', () => {
  const snapshot = {
    status: 2,
    tripId: 25104,
    aircraft: { _id: { $oid: 'acN69' } },
    client: { company: { _id: { $oid: 'co1' } }, customer: { _id: { $oid: 'cust1' } } },
  };
  assert.deepEqual(tripColumnsFromSnapshot(snapshot), {
    status: 2,
    trip_number: '25104',
    aircraft_lf_oid: 'acN69',
    company_lf_oid: 'co1',
    customer_lf_oid: 'cust1',
  });
});

test('tripColumnsFromSnapshot is null-safe', () => {
  assert.deepEqual(tripColumnsFromSnapshot(null), {
    status: null, trip_number: null, aircraft_lf_oid: null, company_lf_oid: null, customer_lf_oid: null,
  });
});
