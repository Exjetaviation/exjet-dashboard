// backend/src/scheduling/mapScheduledLegs.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapScheduledLegs } from './mapScheduledLegs.js';

// Two legs of one round-trip dispatch, shaped like real /api/analytics/scheduledLegs.
const dispatch = {
  _id: { $oid: 'disp1' },
  tripId: 25104,
  status: 'booked',
  aircraft: { _id: { $oid: 'acN69' }, tailNumber: 'N69FP' },
  client: { company: { _id: { $oid: 'co1' } }, customer: { _id: { $oid: 'cust1' } } },
};
const pilots = [
  { seat: 2, user: { _id: { $oid: 'pilotPIC' } } },
  { seat: 3, user: { _id: { $oid: 'pilotSIC' } } },
];
const legOut = {
  _id: { $oid: 'legB' }, status: 'booked', dispatch, pilots,
  departure: { airport: 'TJSJ', time: 1765290600000 },
  arrival: { airport: 'KFXE', time: 1765305000000 },
};
const legBack = {
  _id: { $oid: 'legA' }, status: 'booked', dispatch, pilots,
  departure: { airport: 'KFXE', time: 1765207800000 }, // earlier than legB
  arrival: { airport: 'TJSJ', time: 1765222200000 },
};

test('mapScheduledLegs dedupes the trip and maps its fields', () => {
  const { trips } = mapScheduledLegs([legOut, legBack]);
  assert.equal(trips.length, 1);
  assert.equal(trips[0].lfOid, 'disp1');
  assert.deepEqual(trips[0].values, {
    status: 'booked',
    trip_number: '25104',
    aircraft_lf_oid: 'acN69',
    company_lf_oid: 'co1',
    customer_lf_oid: 'cust1',
  });
});

test('mapScheduledLegs maps legs and orders seq by departure time', () => {
  const { legs } = mapScheduledLegs([legOut, legBack]);
  assert.equal(legs.length, 2);
  const a = legs.find((x) => x.lfOid === 'legA');
  const b = legs.find((x) => x.lfOid === 'legB');
  assert.equal(a.values.dep_icao, 'KFXE');
  assert.equal(a.values.arr_icao, 'TJSJ');
  assert.equal(a.values.dep_time, new Date(1765207800000).toISOString());
  assert.equal(a.values.seq, 0);            // earlier departure
  assert.equal(b.values.seq, 1);
  assert.equal(a.ref.tripLfOid, 'disp1');
  assert.equal('status' in a.values, false); // legs carry no status column
});

test('mapScheduledLegs maps PIC/SIC crew with composite ids and leg refs', () => {
  const { crew } = mapScheduledLegs([legBack]);
  assert.equal(crew.length, 2);
  const pic = crew.find((c) => c.values.seat === 'PIC');
  assert.equal(pic.lfOid, 'legA:PIC');
  assert.equal(pic.values.crew_lf_oid, 'pilotPIC');
  assert.equal(pic.ref.legLfOid, 'legA');
  assert.ok(crew.some((c) => c.values.seat === 'SIC' && c.values.crew_lf_oid === 'pilotSIC'));
});

test('mapScheduledLegs skips a leg with no dispatch id', () => {
  const orphan = { _id: { $oid: 'legX' }, departure: { airport: 'KFXE' } };
  const { trips, legs } = mapScheduledLegs([orphan]);
  assert.equal(trips.length, 0);
  assert.equal(legs.length, 0);
});

// Regression (Trip #25093): the snapshot must carry the ASSIGNED passenger count
// (the `passengers` list), not LF's passengerCount field — so every mirror-backed
// display (lists, calendar, trip page) shows the right number.
test('mapScheduledLegs stores assigned passenger count as snapshot.passengerCount', () => {
  const leg = {
    _id: { $oid: 'legP' }, dispatch, pilots,
    departure: { airport: 'KFXE', time: 1 }, arrival: { airport: 'KDAL', time: 2 },
    passengerCount: 15,
    passengers: Array.from({ length: 13 }, (_, i) => ({ user: { _id: { $oid: String(i) } }, seat: i + 1 })),
  };
  const { legs } = mapScheduledLegs([leg]);
  assert.equal(legs[0].snapshot.passengerCount, 13);
});

test('mapScheduledLegs falls back to passengerCount when no assigned list', () => {
  const leg = {
    _id: { $oid: 'legQ' }, dispatch, pilots,
    departure: { airport: 'KFXE', time: 1 }, arrival: { airport: 'KDAL', time: 2 },
    passengerCount: 6,
  };
  const { legs } = mapScheduledLegs([leg]);
  assert.equal(legs[0].snapshot.passengerCount, 6);
});
