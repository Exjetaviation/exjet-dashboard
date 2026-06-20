import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateLegMinutes, flightTimeForLeg } from './flightTime.js';

const profile = { cruise_kt: 452, buffer_min: 14 };

test('estimateLegMinutes = buffer + distance/cruise', () => {
  assert.equal(Math.round(estimateLegMinutes(452, profile)), 74); // 14 + 60
  assert.equal(estimateLegMinutes(null, profile), null);
});

test('flightTimeForLeg prefers history when present, else estimates', () => {
  const histAvg = { 'Gulfstream GIV SP|KFXE|KTEB': 132 };
  const h = flightTimeForLeg(
    { depIcao: 'KFXE', arrIcao: 'KTEB', aircraftType: 'Gulfstream GIV SP', distanceNm: 925 },
    { profile, historyAvg: histAvg });
  assert.equal(h.source, 'history');
  assert.equal(h.minutes, 132);

  const e = flightTimeForLeg(
    { depIcao: 'KFXE', arrIcao: 'KMIA', aircraftType: 'Gulfstream GIV SP', distanceNm: 452 },
    { profile, historyAvg: histAvg });
  assert.equal(e.source, 'estimate');
  assert.equal(Math.round(e.minutes), 74);
});

test('flightTimeForLeg uses a route-only history match when aircraft type is unknown (native quotes)', () => {
  const histAvg = { 'KFXE|KTEB': 130 }; // route-only key, no type
  const h = flightTimeForLeg(
    { depIcao: 'KFXE', arrIcao: 'KTEB', aircraftType: null, distanceNm: 925 },
    { profile, historyAvg: histAvg });
  assert.equal(h.source, 'history');
  assert.equal(h.minutes, 130);
});
