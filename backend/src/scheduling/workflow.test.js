// backend/src/scheduling/workflow.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workflowStage, nextActions, isValidTransition, shouldAutoClose } from './workflow.js';

test('workflowStage normalizes our strings and LevelFlight codes', () => {
  assert.equal(workflowStage('quote'), 'quote');
  assert.equal(workflowStage('released'), 'released');
  assert.equal(workflowStage(0), 'booked');
  assert.equal(workflowStage('2'), 'closed');
  assert.equal(workflowStage(4), 'released');
  assert.equal(workflowStage('weird'), 'quote');
  assert.equal(workflowStage(null), 'quote');
});

test('nextActions exposes the valid forward actions per stage', () => {
  assert.deepEqual(nextActions('quote').map((a) => a.action), ['book', 'cancel']);
  assert.deepEqual(nextActions('booked').map((a) => a.action), ['release', 'cancel']);
  assert.deepEqual(nextActions('released').map((a) => a.action), ['cancel']);
  assert.deepEqual(nextActions('closed'), []);
  assert.deepEqual(nextActions('cancelled'), []);
  assert.deepEqual(nextActions(0).map((a) => a.action), ['release', 'cancel']); // LF booked
});

test('isValidTransition enforces the sequence (no skipping)', () => {
  assert.equal(isValidTransition('quote', 'booked'), true);
  assert.equal(isValidTransition('quote', 'released'), false);
  assert.equal(isValidTransition('booked', 'released'), true);
  assert.equal(isValidTransition('released', 'closed'), false); // auto only
  assert.equal(isValidTransition('quote', 'cancelled'), true);
  assert.equal(isValidTransition('closed', 'booked'), false);
});

test('shouldAutoClose closes a released trip only once all legs have arrived', () => {
  const now = '2026-07-01T20:00:00.000Z';
  const past = Date.parse('2026-07-01T18:00:00.000Z');
  const future = Date.parse('2026-07-02T18:00:00.000Z');
  assert.equal(shouldAutoClose('released', [past, past], now), true);
  assert.equal(shouldAutoClose('released', [past, future], now), false);
  assert.equal(shouldAutoClose('released', [], now), false);
  assert.equal(shouldAutoClose('released', [null], now), false);
  assert.equal(shouldAutoClose('booked', [past], now), false);
});
