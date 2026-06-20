import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distinctAircraft, distinctClients, distinctCrew, overviewStats, crewRole } from './schedulingAggregate.js';

const leg = (over = {}) => ({
  dispatch: {
    _id: { $oid: over.trip || 't1' },
    aircraft: { tailNumber: over.tail || 'N69FP', type: { name: 'Gulfstream GIV SP' }, paxSeats: 15 },
    client: { company: { name: over.client || 'Liberty Jet', wholesale: true } },
  },
  pilots: over.pilots || [{ seat: 2, user: { _id: { $oid: 'u1' }, firstName: 'Adolfo', lastName: 'Martinez', title: 'Chief Pilot' } }],
  attendants: over.attendants || [],
  departure: { airport: 'KFXE', time: over.dep ?? 0 },
  arrival: { airport: 'KTEB', time: 0 },
  passengerCount: 0,
});

test('distinctAircraft groups by tail with leg/trip counts', () => {
  const a = distinctAircraft([leg({ tail: 'N69FP', trip: 't1' }), leg({ tail: 'N69FP', trip: 't2' }), leg({ tail: 'N408JS', trip: 't3' })]);
  assert.equal(a.length, 2);
  const fp = a.find((x) => x.tail === 'N69FP');
  assert.equal(fp.legCount, 2);
  assert.equal(fp.tripCount, 2);
  assert.equal(fp.type, 'Gulfstream GIV SP');
  assert.equal(fp.paxSeats, 15);
});

test('distinctClients groups by company name, sorted by trips', () => {
  const c = distinctClients([leg({ client: 'Liberty Jet', trip: 't1' }), leg({ client: 'Liberty Jet', trip: 't2' }), leg({ client: 'Acme', trip: 't3' })]);
  assert.equal(c.length, 2);
  assert.equal(c[0].name, 'Liberty Jet');
  assert.equal(c[0].tripCount, 2);
  assert.equal(c[0].wholesale, true);
});

test('distinctCrew dedupes by user and derives role from lowest seat', () => {
  const crew = distinctCrew([
    leg({ pilots: [{ seat: 2, user: { _id: { $oid: 'u1' }, firstName: 'A', lastName: 'M', title: 'Chief Pilot' } }], attendants: [{ seat: 7, user: { _id: { $oid: 'u2' }, firstName: 'O', lastName: 'A' } }] }),
    leg({ pilots: [{ seat: 3, user: { _id: { $oid: 'u1' }, firstName: 'A', lastName: 'M' } }] }),
  ]);
  const am = crew.find((x) => x.name === 'A M');
  assert.equal(am.legCount, 2);
  assert.equal(am.role, 'PIC');
  const oa = crew.find((x) => x.name === 'O A');
  assert.equal(oa.role, 'Cabin');
});

test('overviewStats counts trips/aircraft/clients and upcoming departures', () => {
  const now = 1000000;
  const s = overviewStats([
    leg({ trip: 't1', dep: now + 1000 }),
    leg({ trip: 't1', dep: now + 8 * 86400000 }),
    leg({ trip: 't2', tail: 'N408JS', client: 'Acme', dep: now - 1000 }),
  ], now);
  assert.equal(s.tripCount, 2);
  assert.equal(s.aircraftCount, 2);
  assert.equal(s.clientCount, 2);
  assert.equal(s.flightsToday, 1);
  assert.equal(s.upcoming.length, 2);
});

test('crewRole maps seats', () => {
  assert.equal(crewRole(2), 'PIC');
  assert.equal(crewRole(3), 'SIC');
  assert.equal(crewRole(7), 'Cabin');
});
