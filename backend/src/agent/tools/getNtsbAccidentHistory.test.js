// Unit tests for the NTSB tool. The aggregation/decoding logic lives in
// scripts/ntsbProfile.js (see ntsbProfile.test.js); the tool itself just
// resolves the airport code and reads the pre-aggregated profile, so the only
// pure piece to test here is the ICAO→FAA form resolution.
// Run with: node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { airportQueryForms } from './getNtsbAccidentHistory.js';

test('airportQueryForms de-Ks US ICAO codes and queries both forms', () => {
  assert.deepEqual(airportQueryForms('KFLL'), ['KFLL', 'FLL']);
  assert.deepEqual(airportQueryForms('kfll'), ['KFLL', 'FLL']);
  assert.deepEqual(airportQueryForms('MMUN'), ['MMUN']); // non-US: unchanged
  assert.deepEqual(airportQueryForms('FLL'), ['FLL']);   // already 3-letter
  assert.deepEqual(airportQueryForms(''), []);
});
