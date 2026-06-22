import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aircraftInfo } from './fleet.js';

test('aircraftInfo: known tail returns type + seats', () => {
  assert.deepEqual(aircraftInfo('N69FP'), { type: 'Gulfstream GIV SP', maxPax: 15 });
});
test('aircraftInfo: case/space-insensitive', () => {
  assert.deepEqual(aircraftInfo(' n408js '), { type: 'Gulfstream GIV SP', maxPax: 15 });
});
test('aircraftInfo: unknown tail returns nulls', () => {
  assert.deepEqual(aircraftInfo('N999ZZ'), { type: null, maxPax: null });
});
