import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overnightExtraCols } from './calendarRange.js';

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
