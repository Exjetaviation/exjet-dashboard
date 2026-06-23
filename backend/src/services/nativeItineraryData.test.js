import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toLfLeg } from './nativeItineraryData.js';
import { mapItineraryLeg } from './itineraryData.js';

const snap = {
  passengerCount: 2, isPositioning: false,
  departure: { time: Date.parse('2026-07-01T12:00:00Z'), fbo: { name: 'BANYAN AIR SERVICE', address: { street: '5360 NW 20TH TERRACE', city: 'FORT LAUDERDALE' }, phones: ['800-200-2031'] } },
  arrival: { time: Date.parse('2026-07-01T14:13:00Z'), fbo: null },
  pilots: [{ seat: 2, user: { _id: 'p1', firstName: 'Mike', lastName: 'Reyes' } }, { seat: 3, user: { _id: 'p2', firstName: 'Dave', lastName: 'Cohen' } }],
  attendants: [{ user: { _id: 'a1', firstName: 'Lauren', lastName: 'Pierce' } }],
};
const legRow = { dep_icao: 'KFXE', arr_icao: 'KTEB', dep_time: '2026-07-01T12:00:00Z', arr_time: '2026-07-01T14:13:00Z', lf_synced_snapshot: snap };
const paxLf = [
  { seat: 1, user: { _id: 'x1', firstName: 'John', lastName: 'Carter' } },
  { seat: 2, user: { _id: 'x2', firstName: 'Emily', lastName: 'Carter' } },
];

test('toLfLeg → mapItineraryLeg yields the itinerary leg shape', () => {
  const m = mapItineraryLeg(toLfLeg(legRow, { minutes: 133, distanceNm: 932 }, paxLf));
  assert.equal(m.from, 'KFXE');
  assert.equal(m.to, 'KTEB');
  assert.equal(m.fromName, 'Fort Lauderdale Executive Airport');
  assert.equal(m.toName, 'Teterboro Airport');
  assert.equal(m.distance, 932);
  assert.equal(m.eft, '2:13');
  assert.equal(m.pax, 2);
  assert.equal(m.passengers[0].name, 'John Carter');
  assert.equal(m.passengers[0].lead, true);
  assert.equal(m.crew.pic, 'Mike Reyes');
  assert.equal(m.crew.sic, 'Dave Cohen');
  assert.deepEqual(m.crew.ca, ['Lauren Pierce']);
  assert.equal(m.depFbo.name, 'BANYAN AIR SERVICE');
  assert.ok(Array.isArray(m.fromLatLng) && m.fromLatLng[0] > 0 && m.fromLatLng[1] < 0);
});

test('toLfLeg: positioning/empty leg carries no passengers', () => {
  const ferry = { ...legRow, lf_synced_snapshot: { ...snap, passengerCount: 0, isPositioning: true } };
  const m = mapItineraryLeg(toLfLeg(ferry, { minutes: 100, distanceNm: 400 }, paxLf));
  assert.equal(m.pax, 0);
  assert.deepEqual(m.passengers, []);
});
