import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitProfile, DEFAULT_PROFILE, MIN_LEGS } from './perfProfile.js';

test('fitProfile recovers cruise + buffer from (distance, minutes) pairs', () => {
  const pairs = [200, 400, 600, 800, 1000, 1200, 900, 500].map((nm) => [nm, 14 + (nm / 452) * 60]);
  const p = fitProfile(pairs);
  assert.ok(Math.abs(p.cruise_kt - 452) < 2, `cruise ${p.cruise_kt}`);
  assert.ok(Math.abs(p.buffer_min - 14) < 0.5, `buffer ${p.buffer_min}`);
  assert.ok(p.r2 > 0.99);
  assert.equal(p.n_legs, pairs.length);
});

test('fitProfile returns null below the minimum sample or with bad slope', () => {
  assert.equal(fitProfile([[100, 30], [200, 45]]), null);
  const flat = Array.from({ length: MIN_LEGS }, (_, i) => [100 + i, 60]);
  assert.equal(fitProfile(flat), null);
});

test('DEFAULT_PROFILE seeds the recovered GIV-SP numbers', () => {
  assert.equal(DEFAULT_PROFILE.cruise_kt, 452);
  assert.equal(DEFAULT_PROFILE.buffer_min, 14);
});
