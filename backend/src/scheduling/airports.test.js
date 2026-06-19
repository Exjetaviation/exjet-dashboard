import { test } from 'node:test';
import assert from 'node:assert/strict';
import { airportCoord } from './airports.js';

test('airportCoord returns coords for a known airport, case/space-insensitive', () => {
  const kfxe = airportCoord('KFXE');
  assert.ok(kfxe && typeof kfxe.lat === 'number' && typeof kfxe.lng === 'number');
  assert.deepEqual(airportCoord(' kfxe '), kfxe);
});

test('airportCoord returns null for unknown/blank input', () => {
  assert.equal(airportCoord('ZZZZ'), null);
  assert.equal(airportCoord(''), null);
  assert.equal(airportCoord(null), null);
});
