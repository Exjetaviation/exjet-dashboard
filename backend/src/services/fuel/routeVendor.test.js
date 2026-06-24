import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vendorFor } from './routeVendor.js';

test('vendorFor: by sender domain (primary)', () => {
  assert.equal(vendorFor({ from: 'Everest <fuelmanagement@everest-fuel.com>', filename: 'x.csv' }), 'everest');
  assert.equal(vendorFor({ from: 'WFS <fosnda@wfscorp.com>', filename: 'x.csv' }), 'wfs');
});
test('vendorFor: falls back to filename', () => {
  assert.equal(vendorFor({ from: 'unknown@x.com', filename: 'WFS FUEL.csv' }), 'wfs');
  assert.equal(vendorFor({ from: 'unknown@x.com', filename: 'Everest Fuel_06_23_2026.csv' }), 'everest');
});
test('vendorFor: unknown → null', () => {
  assert.equal(vendorFor({ from: 'a@b.com', filename: 'random.csv' }), null);
});
