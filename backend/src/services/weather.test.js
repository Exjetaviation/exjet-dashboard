// backend/src/services/weather.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weatherCodeLabel } from './weather.js';

test('weatherCodeLabel maps known WMO codes', () => {
  assert.equal(weatherCodeLabel(0), 'Clear');
  assert.equal(weatherCodeLabel(3), 'Overcast');
  assert.equal(weatherCodeLabel(61), 'Rain');
  assert.equal(weatherCodeLabel(95), 'Thunderstorm');
});

test('weatherCodeLabel falls back for unknown/null codes', () => {
  assert.equal(weatherCodeLabel(999), '—');
  assert.equal(weatherCodeLabel(null), '—');
});
