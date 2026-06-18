// backend/src/scheduling/freshness.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshnessLabel } from './freshness.js';

const NOW = '2026-06-18T19:00:00.000Z';

test('freshnessLabel reports unknown when never synced', () => {
  assert.deepEqual(freshnessLabel(null, NOW), { state: 'unknown', text: 'Never synced' });
});

test('freshnessLabel is fresh within the stale window', () => {
  const twoMinAgo = '2026-06-18T18:58:00.000Z';
  assert.deepEqual(freshnessLabel(twoMinAgo, NOW), { state: 'fresh', text: 'Synced 2 min ago' });
});

test('freshnessLabel says "just now" under a minute', () => {
  const tenSecAgo = '2026-06-18T18:59:50.000Z';
  assert.deepEqual(freshnessLabel(tenSecAgo, NOW), { state: 'fresh', text: 'Synced just now' });
});

test('freshnessLabel is stale past the window (default 10 min)', () => {
  const twentyMinAgo = '2026-06-18T18:40:00.000Z';
  assert.deepEqual(freshnessLabel(twentyMinAgo, NOW), { state: 'stale', text: 'Synced 20 min ago' });
});
