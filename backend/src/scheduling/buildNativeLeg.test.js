// backend/src/scheduling/buildNativeLeg.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNativeLegSnapshot } from './buildNativeLeg.js';

test('buildNativeLegSnapshot builds an LF-shaped leg from native columns', () => {
  const snap = buildNativeLegSnapshot(
    { dep_icao: 'KFXE', arr_icao: 'KTEB', dep_time: '2026-07-01T14:00:00.000Z', arr_time: '2026-07-01T16:30:00.000Z', seq: 0 },
    { id: 'trip-uuid', trip_number: 'N-1001', status: 'quote', aircraft_tail: 'N69FP', customer_name: 'Acme Co' },
  );
  assert.equal(snap._id.$oid, 'trip-uuid:0');
  assert.equal(snap.departure.airport, 'KFXE');
  assert.equal(snap.departure.time, Date.parse('2026-07-01T14:00:00.000Z'));
  assert.equal(snap.arrival.airport, 'KTEB');
  assert.equal(snap.dispatch._id.$oid, 'trip-uuid');
  assert.equal(snap.dispatch.tripId, 'N-1001');
  assert.equal(snap.dispatch.aircraft.tailNumber, 'N69FP');
  assert.equal(snap.dispatch.client.company.name, 'Acme Co');
  assert.equal(snap.status, 'quote');
  assert.deepEqual(snap.pilots, []);
});

test('buildNativeLegSnapshot is null-safe and defaults status to quote', () => {
  const snap = buildNativeLegSnapshot({}, {});
  assert.equal(snap.departure.airport, null);
  assert.equal(snap.departure.time, null);
  assert.equal(snap.dispatch.aircraft.tailNumber, null);
  assert.equal(snap.status, 'quote');
  assert.equal(snap.passengerCount, 0);
  assert.equal(snap.isPositioning, false);
});

test('buildNativeLegSnapshot carries pax and positioning for re-pricing', () => {
  const snap = buildNativeLegSnapshot({ dep_icao: 'KFXE', arr_icao: 'KMIA', seq: 0, pax: 3, positioning: true }, { id: 't', status: 'quote' });
  assert.equal(snap.passengerCount, 3);
  assert.equal(snap.isPositioning, true);
});

test('buildNativeLegSnapshot carries dep/arr FBO when provided', () => {
  const fbo = { fbo_id: '1039', name: 'BANYAN AIR SERVICE', address: { city: 'FORT LAUDERDALE' }, phones: ['800-200-2031'], comms: { arinc: '129.85' }, crewNote: null };
  const snap = buildNativeLegSnapshot({ dep_icao: 'KFXE', arr_icao: 'KTEB', dep_fbo: fbo, arr_fbo: null }, { id: 't1' });
  assert.deepEqual(snap.departure.fbo, fbo);
  assert.equal(snap.arrival.fbo, null);
});

test('buildNativeLegSnapshot fbo defaults to null', () => {
  const snap = buildNativeLegSnapshot({ dep_icao: 'KFXE', arr_icao: 'KTEB' }, { id: 't1' });
  assert.equal(snap.departure.fbo, null);
  assert.equal(snap.arrival.fbo, null);
});
