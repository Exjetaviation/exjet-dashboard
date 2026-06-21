// backend/src/services/tripSheet.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexEmployees, mapReleaseLeg, mapManifest, mapMaintenance, flightType, legFlightType } from './tripSheet.js';

test('flightType maps charter vs part 91 purposes', () => {
  assert.deepEqual(flightType(8), { part: 91, label: 'Part 91 · Owner' });
  assert.deepEqual(flightType(4), { part: 91, label: 'Part 91 · Positioning' });
  assert.deepEqual(flightType(undefined), { part: 135, label: '135 · Charter' });
  assert.deepEqual(flightType(1), { part: 135, label: '135 · Charter' });
});

test('legFlightType inherits the dispatch purpose when the leg is charter-default', () => {
  // Owner trip: leg tagged with the implicit charter purpose (7), owner on the dispatch.
  assert.deepEqual(legFlightType({ purpose: 7, dispatch: { purpose: 11 } }), { part: 91, label: 'Part 91 · Owner Lease' });
  // Leg explicitly Part 91 wins.
  assert.deepEqual(legFlightType({ purpose: 8, dispatch: { purpose: 7 } }), { part: 91, label: 'Part 91 · Owner' });
  // Genuine charter on both stays 135.
  assert.deepEqual(legFlightType({ purpose: 7, dispatch: { purpose: 7 } }), { part: 135, label: '135 · Charter' });
});

test('mapReleaseLeg builds a per-leg manifest from the leg passengers', () => {
  const paxById = new Map([['p1', { name: 'Ada Lovelace', weight: 130 }]]);
  const leg = mapReleaseLeg({ passengers: [{ user: { _id: { $oid: 'p1' } } }, { user: { _id: { $oid: 'p2' }, firstName: 'Guest', lastName: 'X' } }] }, new Map(), paxById);
  assert.equal(leg.manifest.length, 2);
  assert.equal(leg.manifest[0].name, 'Ada Lovelace');
  assert.equal(leg.manifest[1].name, 'Guest X');
  // No per-leg passenger list -> null.
  assert.equal(mapReleaseLeg({}).manifest, null);
});

test('mapReleaseLeg flags the lead (unique lowest seat) and lists them first', () => {
  const paxById = new Map([
    ['p1', { name: 'Bob Lee' }],
    ['p2', { name: 'Antonela Roccuzzo' }],
    ['p3', { name: 'Emily Johnson' }],
  ]);
  const leg = mapReleaseLeg({ passengers: [
    { user: { _id: { $oid: 'p1' } }, seat: 9 },
    { user: { _id: { $oid: 'p2' } }, seat: 8 }, // lead
    { user: { _id: { $oid: 'p3' } }, seat: 9 },
  ] }, new Map(), paxById);
  assert.equal(leg.manifest[0].name, 'Antonela Roccuzzo'); // lead first
  assert.deepEqual(leg.manifest.map((p) => p.lead), [true, false, false]);
});

test('mapReleaseLeg falls back to the trip manifest when a leg carries pax but no list', () => {
  const trip = [{ name: 'Ada Lovelace' }, { name: 'Grace Hopper' }];
  // Leg has passengers aboard but no explicit per-leg list -> use the trip manifest.
  assert.deepEqual(mapReleaseLeg({ passengerCount: 2 }, new Map(), new Map(), trip).manifest, trip);
  // Positioning leg (no pax) -> still empty.
  assert.equal(mapReleaseLeg({ passengerCount: 0 }, new Map(), new Map(), trip).manifest, null);
});

const release = {
  callSign: 'SKYHOP 69',
  departure: { airport: 'KFXE', time: 1000, fbo: { name: 'Banyan', address: { street: '5360 NW 20th Ter', city: 'Fort Lauderdale', state: 'FL' }, phones: ['954-491-3170'], comms: { arinc: '130.8', atg: '130.8' }, crewNote: 'Fuel $6.39' } },
  arrival: { airport: 'KMKC', time: 4000, fbo: { name: 'Signature' } },
  passengerCount: 2,
  pilots: [
    { seat: 3, user: { _id: { $oid: 'u-sic' }, firstName: 'Sam', lastName: 'Sic' } },
    { seat: 2, user: { _id: { $oid: 'u-pic' }, firstName: 'Pat', lastName: 'Pic' } },
  ],
  attendants: [{ seat: 5, user: { _id: { $oid: 'u-ca' }, firstName: 'Ava', lastName: 'Att' } }],
  weather: { departure: { raw: 'METAR KFXE 181553Z ...' }, arrival: { raw: 'METAR KMKC 181554Z ...' } },
  _calc: {
    time: '2:43', minutes: 163, distance: { value: 1063 }, fuel: { value: 9350 },
    from: { name: 'Fort Lauderdale Exec', elevation: 13, timezone: 'America/New_York', comms: { TWR: ' 120.900', GND: ' 121.750' }, location: { lat: 26.19, lng: -80.17 } },
    to: { name: 'Kansas City', elevation: 756, comms: { TWR: ' 133.300' }, location: { lat: 39.12, lng: -94.59 } },
  },
  releasedBy: { userName: 'Adolfo Martinez', timestamp: 500 },
  crewNote: 'SLOT PPr 11040729A',
  dispatch: { tripId: 25095, quoteId: 8841, _internal: { summary: 'KFXE, KMKC, KFXE' } },
};

const employees = [
  { _id: { $oid: 'u-pic' }, firstName: 'Pat', lastName: 'Pic', birthday: 211000000000, phones: ['954-701-1015'] },
];

test('mapReleaseLeg maps route, comms, METARs, FBO, fuel', () => {
  const m = mapReleaseLeg(release, indexEmployees(employees));
  assert.equal(m.callSign, 'SKYHOP 69');
  assert.equal(m.from, 'KFXE'); assert.equal(m.to, 'KMKC');
  assert.equal(m.eft, '2:43'); assert.equal(m.distance, 1063); assert.equal(m.fuelBurn, 9350);
  assert.deepEqual(m.fromLatLng, [26.19, -80.17]);
  assert.deepEqual(m.depComms, { TWR: '120.900', GND: '121.750' });
  assert.equal(m.depMetar, 'METAR KFXE 181553Z ...');
  assert.equal(m.depFbo.name, 'Banyan');
  assert.equal(m.depFbo.arinc, '130.8');
  assert.equal(m.depFbo.phones[0], '954-491-3170');
});

test('mapReleaseLeg picks PIC=seat2 / SIC=seat3 and joins employee DOB/phone', () => {
  const m = mapReleaseLeg(release, indexEmployees(employees));
  assert.equal(m.crew.pic.name, 'Pat Pic');
  assert.equal(m.crew.pic.phone, '954-701-1015');   // joined from employees
  assert.equal(m.crew.pic.dob, 211000000000);
  assert.equal(m.crew.sic.name, 'Sam Sic');
  assert.equal(m.crew.sic.phone, null);              // not in employee directory
  assert.deepEqual(m.crew.ca.map((x) => x.name), ['Ava Att']);
});

test('mapManifest produces manifest rows with passport', () => {
  const rows = mapManifest([
    { _fullName: 'Jane Doe', gender: 'Female', weight: 160, birthday: 5, citizenship: 'US', documents: [{ number: 'AAF591281', country: 'AR' }] },
  ]);
  assert.equal(rows[0].name, 'Jane Doe');
  assert.equal(rows[0].weight, 160);
  assert.equal(rows[0].passport, 'AAF591281 - AR');
});

test('mapMaintenance summarizes airframe, engines, upcoming, closed', () => {
  const m = mapMaintenance({
    aircraft: { type: { name: 'Gulfstream GIV SP' }, serial: '1180', _camp: { hours: 9530, landings: 5571, reported: 9 }, components: { engines: { 1: { model: 'TAY 611-8', serial: '16463' } }, apu: { model: 'GTCP36', serial: 'P-542' } } },
    mx: [{ name: 'FAN FILTER INSP', hours: { due: 9505, remaining: 50 } }, { name: 'NDT INSP', hours: { due: 9516, remaining: 600 } }],
    closedEvents: [{ title: 'Microwave inop', eventDate: 1778456220000, id: 25 }],
  });
  assert.equal(m.airframe.type, 'Gulfstream GIV SP');
  assert.equal(m.airframe.hours, 9530);
  assert.equal(m.engines[0].model, 'TAY 611-8');
  assert.equal(m.apu.serial, 'P-542');
  assert.equal(m.upcoming[0].name, 'FAN FILTER INSP'); // sorted by remaining asc
  assert.equal(m.upcoming[0].remaining, 50);
  assert.equal(m.closed[0].title, 'Microwave inop');
});
