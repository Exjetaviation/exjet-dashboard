import test from 'node:test';
import assert from 'node:assert/strict';
import { minutesBetween, minutesToHhmm, hoursFromMinutes } from './flightTime.js';

test('minutesBetween computes whole minutes across day boundary', () => {
  const off = '2026-06-19T23:25:00Z';
  const on = '2026-06-20T01:38:00Z';
  assert.equal(minutesBetween(off, on), 133); // 2:13
});

test('minutesBetween returns null on missing input', () => {
  assert.equal(minutesBetween(null, '2026-06-20T01:38:00Z'), null);
  assert.equal(minutesBetween('2026-06-19T23:25:00Z', undefined), null);
});

test('minutesToHhmm formats with zero padding', () => {
  assert.equal(minutesToHhmm(133), '2:13');
  assert.equal(minutesToHhmm(5), '0:05');
  assert.equal(minutesToHhmm(0), '0:00');
});

test('hoursFromMinutes converts to decimal hours', () => {
  assert.equal(hoursFromMinutes(133), 133 / 60);
  assert.equal(hoursFromMinutes(null), null);
});
