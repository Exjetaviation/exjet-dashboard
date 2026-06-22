import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fbosFromLfResponse } from './fbos.js';

const lf = {
  success: true,
  fbos: {
    '1039': {
      id: '1039', name: 'BANYAN AIR SERVICE',
      address: { street: '5360 NW 20TH TERRACE', city: 'FORT LAUDERDALE', state: 'FLORIDA', postalCode: '33309', country: 'UNITED STATES' },
      loc: { type: 'Point', coordinates: [-80.1725, 25.2019] },
      phones: ['800-200-2031', '954-491-3170'], fax: '954-771-0281',
      email: 'frontdesk@banyanair.com', website: 'www.banyanair.com',
      comms: { arinc: '129.85' }, hours: '06:00 - 22:00',
    },
  },
};

test('fbosFromLfResponse: maps fbos to rows (coordinates are [lng,lat])', () => {
  const rows = fbosFromLfResponse(lf, 'kfxe');
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.fbo_id, '1039');
  assert.equal(r.icao, 'KFXE');
  assert.equal(r.name, 'BANYAN AIR SERVICE');
  assert.equal(r.lng, -80.1725);
  assert.equal(r.lat, 25.2019);
  assert.deepEqual(r.phones, ['800-200-2031', '954-491-3170']);
  assert.equal(r.email, 'frontdesk@banyanair.com');
  assert.equal(r.raw.id, '1039');
});

test('fbosFromLfResponse: missing/empty fbos → []', () => {
  assert.deepEqual(fbosFromLfResponse({ success: true }, 'KFXE'), []);
  assert.deepEqual(fbosFromLfResponse(null, 'KFXE'), []);
});
