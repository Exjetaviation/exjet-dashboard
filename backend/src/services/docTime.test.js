// backend/src/services/docTime.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { easternTime, zuluTime } from './docTime.js';

const ms = Date.parse('2026-06-22T12:00:00Z'); // 12:00 UTC == 08:00 EDT (summer)

test('zuluTime renders UTC as HH:MMZ', () => {
  assert.equal(zuluTime(ms), '12:00Z');
});

test('easternTime renders Eastern time with the zone abbreviation', () => {
  const s = easternTime(ms);
  assert.match(s, /Jun 22/);
  assert.match(s, /08:00\s?AM/);
  assert.match(s, /EDT/); // summer -> EDT, winter -> EST (auto)
});

test('both are null-safe', () => {
  assert.equal(easternTime(null), '');
  assert.equal(zuluTime(null), '');
});
