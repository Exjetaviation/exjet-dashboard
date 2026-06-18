// backend/src/scheduling/attachFk.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachFk } from './attachFk.js';

test('attachFk injects the resolved parent id into values', () => {
  const records = [
    { lfOid: 'legA', values: { dep_icao: 'KFXE' }, ref: { tripLfOid: 'disp1' } },
    { lfOid: 'legB', values: { dep_icao: 'TJSJ' }, ref: { tripLfOid: 'disp1' } },
  ];
  const idByLfOid = new Map([['disp1', 'trip-uuid-1']]);
  const out = attachFk(records, 'trip_id', (r) => r.ref.tripLfOid, idByLfOid);
  assert.equal(out.length, 2);
  assert.equal(out[0].values.trip_id, 'trip-uuid-1');
  assert.equal(out[0].values.dep_icao, 'KFXE'); // original values preserved
  assert.equal(out[0].lfOid, 'legA');
});

test('attachFk drops records whose parent id is unknown', () => {
  const records = [
    { lfOid: 'legA', values: {}, ref: { tripLfOid: 'disp1' } },
    { lfOid: 'legOrphan', values: {}, ref: { tripLfOid: 'missing' } },
  ];
  const idByLfOid = new Map([['disp1', 'trip-uuid-1']]);
  const out = attachFk(records, 'trip_id', (r) => r.ref.tripLfOid, idByLfOid);
  assert.equal(out.length, 1);
  assert.equal(out[0].lfOid, 'legA');
});

test('attachFk does not mutate the input records', () => {
  const records = [{ lfOid: 'legA', values: { dep_icao: 'KFXE' }, ref: { tripLfOid: 'disp1' } }];
  attachFk(records, 'trip_id', (r) => r.ref.tripLfOid, new Map([['disp1', 'u1']]));
  assert.equal('trip_id' in records[0].values, false);
});
