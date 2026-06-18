// backend/src/scheduling/canEdit.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canEditScheduling } from './canEdit.js';

test('canEditScheduling allows editor roles', () => {
  assert.equal(canEditScheduling('dispatcher'), true);
  assert.equal(canEditScheduling('scheduler'), true);
  assert.equal(canEditScheduling('ops_control'), true);
  assert.equal(canEditScheduling('admin'), true);
  assert.equal(canEditScheduling('owner'), true);
});

test('canEditScheduling denies non-editor and missing roles', () => {
  assert.equal(canEditScheduling('crew'), false);
  assert.equal(canEditScheduling('pilot'), false);
  assert.equal(canEditScheduling(undefined), false);
  assert.equal(canEditScheduling(null), false);
  assert.equal(canEditScheduling(''), false);
});
