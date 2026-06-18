// backend/src/services/itineraryData.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapItineraryLeg, mapClient } from './itineraryData.js';

const leg = {
  departure: { airport: 'KFXE', time: 1000, fbo: { name: 'Banyan', address: { street: '5360 NW 20th Ter', city: 'Fort Lauderdale', state: 'FL' }, phones: ['+1 954-491-3170'] } },
  arrival: { airport: 'KMIA', time: 4000, fbo: { name: 'Signature', address: { street: '5', city: 'Miami', state: 'FL' }, phones: ['+1 305-000-0000'] } },
  passengerCount: 4,
  pilots: [
    { seat: 3, user: { firstName: 'Sam', lastName: 'Sic' } },
    { seat: 2, user: { firstName: 'Pat', lastName: 'Pic' } },
  ],
  attendants: [{ seat: 5, user: { firstName: 'Ava', lastName: 'Att' } }],
  _calc: {
    time: '0:42', distance: { value: 92 },
    from: { name: 'Fort Lauderdale Executive', location: { lat: 26.19, lng: -80.17 } },
    to: { name: 'Miami Intl', location: { lat: 25.79, lng: -80.29 } },
  },
};

test('mapItineraryLeg maps route, crew (PIC=seat2/SIC=seat3), fbo, coords', () => {
  const m = mapItineraryLeg(leg);
  assert.equal(m.from, 'KFXE');
  assert.equal(m.to, 'KMIA');
  assert.equal(m.eft, '0:42');
  assert.equal(m.distance, 92);
  assert.equal(m.pax, 4);
  assert.deepEqual(m.fromLatLng, [26.19, -80.17]);
  assert.deepEqual(m.toLatLng, [25.79, -80.29]);
  assert.equal(m.crew.pic, 'Pat Pic');
  assert.equal(m.crew.sic, 'Sam Sic');
  assert.deepEqual(m.crew.ca, ['Ava Att']);
  assert.equal(m.depFbo.name, 'Banyan');
  assert.equal(m.depFbo.address, '5360 NW 20th Ter, Fort Lauderdale, FL');
  assert.equal(m.depFbo.phone, '+1 954-491-3170');
});

test('mapItineraryLeg tolerates missing crew/fbo/coords', () => {
  const m = mapItineraryLeg({ departure: { airport: 'A' }, arrival: { airport: 'B' } });
  assert.equal(m.crew.pic, null);
  assert.deepEqual(m.crew.ca, []);
  assert.equal(m.depFbo, null);
  assert.equal(m.fromLatLng, null);
});

test('mapClient assembles name, company, address from the dispatch', () => {
  const c = mapClient({ client: {
    customer: { firstName: 'Jane', lastName: 'Doe', _fullName: 'Jane Doe' },
    company: { name: 'Concierge One', address: { street: '2735 High St', city: 'London', postalCode: 'W1', country: 'UK' }, phones: ['+44 20'] },
  } });
  assert.equal(c.name, 'Jane Doe');
  assert.equal(c.company, 'Concierge One');
  assert.equal(c.address, '2735 High St, London, W1, UK');
});
