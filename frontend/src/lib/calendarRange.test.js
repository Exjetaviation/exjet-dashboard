import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overnightExtraCols, dayOffsetFromNow, monthOffsetFromNow } from './calendarRange.js';

const H = 3600000;
const day = Date.UTC(2026, 5, 17, 0, 0, 0); // a day start, epoch ms (helper is tz-agnostic)

test('returns 0 when no flight crosses midnight', () => {
  const legs = [{ departure: { time: day + 9 * H }, arrival: { time: day + 11 * H } }];
  assert.equal(overnightExtraCols(legs, day, H), 0);
});

test('extends by whole hours to the latest overnight arrival (rounds up)', () => {
  // departs 23:00, arrives 02:30 next day -> 2.5h past midnight -> ceil = 3
  const legs = [{ departure: { time: day + 23 * H }, arrival: { time: day + 26 * H + 30 * 60000 } }];
  assert.equal(overnightExtraCols(legs, day, H), 3);
});

test('ignores flights departing outside the focused day', () => {
  const legs = [
    { departure: { time: day - 2 * H }, arrival: { time: day + 5 * H } },   // departed previous day (mirror)
    { departure: { time: day + 25 * H }, arrival: { time: day + 28 * H } }, // departs next day
  ];
  assert.equal(overnightExtraCols(legs, day, H), 0);
});

test('uses the latest arrival among multiple overnight flights', () => {
  const legs = [
    { departure: { time: day + 22 * H }, arrival: { time: day + 25 * H } }, // +1h
    { departure: { time: day + 23 * H }, arrival: { time: day + 28 * H } }, // +4h
  ];
  assert.equal(overnightExtraCols(legs, day, H), 4);
});

test('skips legs missing times and null entries', () => {
  const legs = [{ departure: {}, arrival: {} }, null, { departure: { time: day + 23 * H } }];
  assert.equal(overnightExtraCols(legs, day, H), 0);
});

test('caps the extension at maxExtra (default 48)', () => {
  const legs = [{ departure: { time: day + 23 * H }, arrival: { time: day + 1000 * H } }];
  assert.equal(overnightExtraCols(legs, day, H), 48);
});

// Build local-time instants so the local-midnight flooring in the helpers is
// deterministic regardless of the test runner's timezone.
const mk = (y, mo, d, h = 0) => new Date(y, mo, d, h, 0, 0, 0).getTime();

test('dayOffsetFromNow: same day is 0, later same day still 0', () => {
  assert.equal(dayOffsetFromNow(mk(2026, 5, 17, 9), mk(2026, 5, 17, 15)), 0);
});

test('dayOffsetFromNow: next day is +1, previous day is -1', () => {
  assert.equal(dayOffsetFromNow(mk(2026, 5, 17, 23), mk(2026, 5, 18, 1)), 1);
  assert.equal(dayOffsetFromNow(mk(2026, 5, 17, 1), mk(2026, 5, 16, 23)), -1);
});

test('monthOffsetFromNow: same month 0, next month +1', () => {
  assert.equal(monthOffsetFromNow(mk(2026, 5, 17), mk(2026, 5, 2)), 0);
  assert.equal(monthOffsetFromNow(mk(2026, 5, 17), mk(2026, 6, 2)), 1);
});

test('monthOffsetFromNow: crosses year boundary (Jan 2026 -> Dec 2025 = -1)', () => {
  assert.equal(monthOffsetFromNow(mk(2026, 0, 5), mk(2025, 11, 20)), -1);
});
