// backend/src/scheduling/formatSyncStatus.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSyncStatus } from './formatSyncStatus.js';

const NOW = '2026-06-18T19:00:00.000Z';

test('formatSyncStatus adds a freshness label per row', () => {
  const rows = [
    { entity: 'scheduledLegs', last_success_at: '2026-06-18T18:58:00.000Z', status: 'ok' },
    { entity: 'other', last_success_at: null, status: 'error' },
  ];
  const out = formatSyncStatus(rows, NOW);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].freshness, { state: 'fresh', text: 'Synced 2 min ago' });
  assert.equal(out[0].entity, 'scheduledLegs'); // original fields preserved
  assert.deepEqual(out[1].freshness, { state: 'unknown', text: 'Never synced' });
});

test('formatSyncStatus returns an empty array for no rows', () => {
  assert.deepEqual(formatSyncStatus([], NOW), []);
});
