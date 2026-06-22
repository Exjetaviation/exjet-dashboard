import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextNumber } from './nextNumber.js';

test('nextNumber: empty list returns the base', () => {
  assert.equal(nextNumber([], 3000), 3000);
});

test('nextNumber: one above the max, ignoring non-numerics', () => {
  assert.equal(nextNumber(['3000', '3007', 'abc', null, 3002], 3000), 3008);
});

test('nextNumber: existing below base still respects base', () => {
  assert.equal(nextNumber(['12'], 26000), 26000);
});
