// backend/src/scheduling/dispatchStatus.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatchStatusLabel, isEditableStatus } from './dispatchStatus.js';

test('dispatchStatusLabel maps known codes and falls back', () => {
  assert.equal(dispatchStatusLabel(0), 'Booked');
  assert.equal(dispatchStatusLabel(2), 'Closed');
  assert.equal(dispatchStatusLabel(4), 'In Progress');
  assert.equal(dispatchStatusLabel(null), '—');
  assert.equal(dispatchStatusLabel(99), 'Status 99');
});

test('isEditableStatus accepts only known codes', () => {
  assert.equal(isEditableStatus(0), true);
  assert.equal(isEditableStatus(2), true);
  assert.equal(isEditableStatus(4), true);
  assert.equal(isEditableStatus(1), false);
  assert.equal(isEditableStatus('2'), false); // numbers only
  assert.equal(isEditableStatus(undefined), false);
});
