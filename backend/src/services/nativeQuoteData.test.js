import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapNativeQuoteLeg } from './nativeQuoteData.js';

test('mapNativeQuoteLeg: builds the quote VM leg shape', () => {
  const leg = { dep_icao: 'KFXE', arr_icao: 'KTEB', dep_time: '2026-07-01T12:00:00Z', arr_time: '2026-07-01T14:13:00Z', pax: 4 };
  const m = mapNativeQuoteLeg(leg, { minutes: 133, distanceNm: 932 });
  assert.equal(m.from, 'KFXE');
  assert.equal(m.to, 'KTEB');
  assert.equal(m.fromName, 'Fort Lauderdale Executive Airport');
  assert.equal(m.toName, 'Teterboro Airport');
  assert.equal(m.distance, 932);
  assert.equal(m.eft, '2:13');
  assert.equal(m.pax, 4);
  assert.equal(m.depTime, Date.parse('2026-07-01T12:00:00Z'));
  assert.ok(Array.isArray(m.fromLatLng) && m.fromLatLng.length === 2);
  assert.ok(Array.isArray(m.toLatLng) && m.toLatLng.length === 2);
});

test('mapNativeQuoteLeg: unknown airport → null name/coords, still maps codes', () => {
  const m = mapNativeQuoteLeg({ dep_icao: 'ZZZZ', arr_icao: 'KTEB', dep_time: null, arr_time: null, pax: 0 }, null);
  assert.equal(m.from, 'ZZZZ');
  assert.equal(m.fromName, null);
  assert.equal(m.fromLatLng, null);
  assert.equal(m.distance, null);
  assert.equal(m.eft, null);
});
