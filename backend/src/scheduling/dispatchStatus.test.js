// backend/src/scheduling/dispatchStatus.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusLabel, isSettableStatus, STATUS_ACTIONS } from './dispatchStatus.js';

test('statusLabel renders LevelFlight numeric codes and workflow statuses', () => {
  assert.equal(statusLabel(0), 'Booked');
  assert.equal(statusLabel('2'), 'Closed');
  assert.equal(statusLabel(4), 'In Progress');
  assert.equal(statusLabel('booked'), 'Booked');
  assert.equal(statusLabel('released'), 'Released');
  assert.equal(statusLabel('cancelled'), 'Cancelled');
  assert.equal(statusLabel(null), '—');
  assert.equal(statusLabel(''), '—');
  assert.equal(statusLabel(99), '99');
});

test('isSettableStatus accepts workflow statuses only', () => {
  assert.equal(isSettableStatus('booked'), true);
  assert.equal(isSettableStatus('released'), true);
  assert.equal(isSettableStatus('closed'), true);
  assert.equal(isSettableStatus('cancelled'), true);
  assert.equal(isSettableStatus(2), false);   // numeric LF codes are not settable
  assert.equal(isSettableStatus('2'), false);
  assert.equal(isSettableStatus('bogus'), false);
  assert.equal(isSettableStatus(undefined), false);
});

test('STATUS_ACTIONS lists the workflow buttons in order', () => {
  assert.deepEqual(STATUS_ACTIONS.map((a) => a.label), ['Book', 'Release', 'Close', 'Cancel']);
  assert.deepEqual(STATUS_ACTIONS.map((a) => a.status), ['booked', 'released', 'closed', 'cancelled']);
});
