// backend/src/services/paxCount.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignedPaxCount } from './paxCount.js';

test('assignedPaxCount counts the assigned passengers list (not passengerCount)', () => {
  assert.equal(assignedPaxCount({ passengerCount: 15, passengers: Array.from({ length: 13 }, () => ({})) }), 13);
});

test('assignedPaxCount falls back to passengerCount when no assigned list', () => {
  assert.equal(assignedPaxCount({ passengerCount: 6 }), 6);
});

test('assignedPaxCount with an empty assigned list reports 0', () => {
  assert.equal(assignedPaxCount({ passengerCount: 4, passengers: [] }), 0);
});

test('assignedPaxCount is null-safe', () => {
  assert.equal(assignedPaxCount(null), null);
  assert.equal(assignedPaxCount({}), null);
});
