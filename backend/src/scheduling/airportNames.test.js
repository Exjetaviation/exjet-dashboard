import { test } from 'node:test';
import assert from 'node:assert/strict';
import { airportName } from './airportNames.js';

test('airportName: known ICAO returns the full name', () => {
  assert.equal(airportName('KFXE'), 'Fort Lauderdale Executive Airport');
});
test('airportName: case/space-insensitive', () => {
  assert.equal(airportName(' kteb '), 'Teterboro Airport');
});
test('airportName: unknown ICAO returns null', () => {
  assert.equal(airportName('ZZZZ'), null);
});
