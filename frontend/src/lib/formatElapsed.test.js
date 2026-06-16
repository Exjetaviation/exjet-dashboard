import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatElapsed } from './formatElapsed.js';

test('formatElapsed: under an hour shows M:SS', () => {
  assert.equal(formatElapsed(0), '0:00');
  assert.equal(formatElapsed(65 * 1000), '1:05');
  assert.equal(formatElapsed(59 * 60 * 1000 + 59 * 1000), '59:59');
});

test('formatElapsed: an hour or more shows H:MM', () => {
  assert.equal(formatElapsed(60 * 60 * 1000), '1:00');
  assert.equal(formatElapsed(2 * 60 * 60 * 1000 + 27 * 60 * 1000), '2:27');
});

test('formatElapsed: null/negative -> dash', () => {
  assert.equal(formatElapsed(null), '—');
  assert.equal(formatElapsed(-5), '—');
});
