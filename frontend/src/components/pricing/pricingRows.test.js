import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtHrs, pinPatch, unpinPatch, normalizePricing } from './pricingRows.js';

test('fmtHrs: minutes-as-hours to H:MM', () => {
  assert.equal(fmtHrs(4.7166), '4:43');
  assert.equal(fmtHrs(0), '0:00');
});

test('pinPatch: sets an override for a line', () => {
  assert.deepEqual(pinPatch({ a: 1 }, 'surcharge', 9000), { overrides: { a: 1, surcharge: 9000 } });
});

test('unpinPatch: removes an override for a line', () => {
  assert.deepEqual(unpinPatch({ a: 1, surcharge: 9000 }, 'surcharge'), { overrides: { a: 1 } });
});

test('normalizePricing: defaults fees[] and fetEnabled from purpose', () => {
  assert.deepEqual(normalizePricing({ total: 1 }, 'owner'), { total: 1, fees: [], fetEnabled: false });
  assert.equal(normalizePricing({ total: 1 }, 'charter').fetEnabled, true);
});
test('normalizePricing: passes through null/error untouched', () => {
  assert.equal(normalizePricing(null), null);
  assert.deepEqual(normalizePricing({ error: 'x' }), { error: 'x' });
});
