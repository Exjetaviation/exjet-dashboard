// backend/src/slack/dispatchList.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDispatchList } from './dispatchList.js';

test('reads dispatches array with oid + tripId', () => {
  const raw = { success: true, dispatches: [
    { _id: { $oid: 'disp1' }, tripId: 25104 },
    { _id: { $oid: 'disp2' }, tripNumber: '25105' },
  ] };
  assert.deepEqual(normalizeDispatchList(raw), [
    { oid: 'disp1', tripId: '25104' },
    { oid: 'disp2', tripId: '25105' },
  ]);
});

test('accepts a bare array and skips rows without an oid', () => {
  const raw = [{ oid: 'd3', tripId: 9 }, { tripId: 10 }];
  assert.deepEqual(normalizeDispatchList(raw), [{ oid: 'd3', tripId: '9' }]);
});

test('returns [] for junk input', () => {
  assert.deepEqual(normalizeDispatchList(null), []);
  assert.deepEqual(normalizeDispatchList({}), []);
});
