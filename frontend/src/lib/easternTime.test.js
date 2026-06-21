import { test } from 'node:test';
import assert from 'node:assert/strict';
import { easternToUTC, zuluParts } from './easternTime.js';

test('converts summer Eastern (EDT, UTC-4) to UTC', () => {
  assert.equal(easternToUTC('2026-06-20', '14:30').toISOString(), '2026-06-20T18:30:00.000Z');
});

test('converts winter Eastern (EST, UTC-5) to UTC', () => {
  assert.equal(easternToUTC('2026-01-15', '14:30').toISOString(), '2026-01-15T19:30:00.000Z');
});

test('handles rollover across midnight UTC', () => {
  // 22:00 EDT on Jun 20 = 02:00Z on Jun 21
  assert.equal(easternToUTC('2026-06-20', '22:00').toISOString(), '2026-06-21T02:00:00.000Z');
});

test('defaults a missing time to local midnight', () => {
  // 00:00 EDT on Jun 20 = 04:00Z
  assert.equal(easternToUTC('2026-06-20', '').toISOString(), '2026-06-20T04:00:00.000Z');
});

test('returns null when the date is missing', () => {
  assert.equal(easternToUTC('', '14:30'), null);
  assert.equal(easternToUTC(null, '14:30'), null);
});

test('zuluParts gives the UTC date and HHMM clock', () => {
  assert.deepEqual(zuluParts(new Date('2026-06-20T18:30:00.000Z')), { date: 'Jun 20', time: '1830' });
});

test('zuluParts is null-safe', () => {
  assert.equal(zuluParts(null), null);
  assert.equal(zuluParts(new Date('nope')), null);
});
