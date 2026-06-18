// backend/src/scheduling/syncWindow.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMonthStarts } from './syncWindow.js';

test('computeMonthStarts covers the months spanning -30d..+90d', () => {
  const now = Date.UTC(2026, 5, 18); // 2026-06-18 (month index 5 = June)
  const starts = computeMonthStarts(now);
  // -30d -> 2026-05-19 (May); +90d -> ~2026-09-16 (Sep). Months: May..Sep = 5 buckets.
  assert.deepEqual(starts, [
    Date.UTC(2026, 4, 1), // May 1
    Date.UTC(2026, 5, 1), // Jun 1
    Date.UTC(2026, 6, 1), // Jul 1
    Date.UTC(2026, 7, 1), // Aug 1
    Date.UTC(2026, 8, 1), // Sep 1
  ]);
});

test('computeMonthStarts honors custom back/forward windows', () => {
  const now = Date.UTC(2026, 0, 15); // 2026-01-15
  const starts = computeMonthStarts(now, { backDays: 0, fwdDays: 0 });
  assert.deepEqual(starts, [Date.UTC(2026, 0, 1)]); // just January
});
