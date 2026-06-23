import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paxToLf, toReleaseLeg } from './nativeTripSheetData.js';
import { mapReleaseLeg, mapManifest } from './tripSheet.js';

const people = [
  { person_id: 'x1', seat: '1', first_name: 'John', last_name: 'Carter', dob: '1971-04-02', gender: 'M', weight_lbs: 185, citizenship: 'USA', passport_number: 'P123', passport_country: 'USA' },
  { person_id: 'x2', seat: '2', first_name: 'Emily', last_name: 'Carter', dob: '1974-09-15', gender: 'F', weight_lbs: 140, citizenship: 'USA', passport_number: null, passport_country: null },
];
const lfPax = paxToLf(people);
const legPassengers = lfPax.map((p) => ({ user: { _id: p._id }, seat: p.seat }));
const snap = {
  passengerCount: 2, isPositioning: false,
  departure: { time: Date.parse('2026-07-01T12:00:00Z'), fbo: { name: 'BANYAN AIR SERVICE', address: { city: 'FORT LAUDERDALE' }, phones: ['800-200-2031'], comms: { arinc: '129.85' } } },
  arrival: { time: Date.parse('2026-07-01T14:13:00Z'), fbo: null },
  pilots: [{ seat: 2, user: { _id: 'p1', firstName: 'Mike', lastName: 'Reyes' } }, { seat: 3, user: { _id: 'p2', firstName: 'Dave', lastName: 'Cohen' } }],
  attendants: [{ user: { _id: 'a1', firstName: 'Lauren', lastName: 'Pierce' } }],
};
const legRow = { dep_icao: 'KFXE', arr_icao: 'KTEB', dep_time: '2026-07-01T12:00:00Z', arr_time: '2026-07-01T14:13:00Z', lf_synced_snapshot: snap };

test('paxToLf + mapManifest yields the manifest rows', () => {
  const m = mapManifest(lfPax);
  assert.equal(m[0].name, 'John Carter');
  assert.equal(m[0].weight, 185);
  assert.equal(m[0].passport, 'P123 - USA');
  assert.equal(m[1].passport, null);
});

test('toReleaseLeg → mapReleaseLeg: charter leg, LF-only fields null', () => {
  const paxById = new Map(lfPax.map((p) => [p._id, mapManifest([p])[0]]));
  const r = mapReleaseLeg(toReleaseLeg(legRow, { minutes: 133, distanceNm: 932 }, legPassengers, 'charter'), new Map(), paxById, mapManifest(lfPax));
  assert.equal(r.from, 'KFXE');
  assert.equal(r.toName, 'Teterboro Airport');
  assert.equal(r.distance, 932);
  assert.equal(r.minutes, 133);
  assert.equal(r.eft, '2:13');
  assert.equal(r.flightType.part, 135);
  assert.equal(r.crew.pic.name, 'Mike Reyes');
  assert.equal(r.crew.pic.dob, null);
  assert.equal(r.depFbo.name, 'BANYAN AIR SERVICE');
  assert.equal(r.manifest[0].name, 'John Carter');
  assert.equal(r.manifest[0].lead, true);
  assert.equal(r.fromElev, null);
  assert.equal(r.depComms, null);
  assert.equal(r.depMetar, null);
  assert.equal(r.fuelBurn, null);
});

test('toReleaseLeg: owner trip → Part 91', () => {
  const r = mapReleaseLeg(toReleaseLeg(legRow, { minutes: 100, distanceNm: 400 }, legPassengers, 'owner'), new Map(), new Map(), []);
  assert.equal(r.flightType.part, 91);
});
