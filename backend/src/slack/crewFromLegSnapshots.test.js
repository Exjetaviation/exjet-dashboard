// backend/src/slack/crewFromLegSnapshots.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crewFromLegSnapshots } from './crewFromLegSnapshots.js';

const leg1 = {
  pilots: [
    { seat: 2, user: { _id: { $oid: 'pic1' }, firstName: 'Ann', lastName: 'Pic', email: 'ann@x.com' } },
    { seat: 3, user: { _id: { $oid: 'sic1' }, firstName: 'Sam', lastName: 'Sic' } },
  ],
  attendants: [{ seat: 7, user: { _id: { $oid: 'fa1' }, firstName: 'Fay' } }],
};
const leg2 = { pilots: [{ seat: 2, user: { _id: { $oid: 'pic1' } } }] }; // dup PIC

test('extracts pilots + attendants, dedups by oid, maps roles', () => {
  const crew = crewFromLegSnapshots([leg1, leg2]);
  assert.deepEqual(crew, [
    { oid: 'pic1', role: 'PIC', name: 'Ann Pic', email: 'ann@x.com' },
    { oid: 'sic1', role: 'SIC', name: 'Sam Sic', email: null },
    { oid: 'fa1', role: 'FA', name: 'Fay', email: null },
  ]);
});

test('handles empty / missing arrays', () => {
  assert.deepEqual(crewFromLegSnapshots([]), []);
  assert.deepEqual(crewFromLegSnapshots([{}]), []);
});
