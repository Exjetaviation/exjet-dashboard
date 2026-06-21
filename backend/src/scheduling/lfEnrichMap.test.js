// backend/src/scheduling/lfEnrichMap.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDate, mapDetailToPatch, mapListToPerson, extFor } from './lfEnrichMap.js';

const ms = (s) => Date.parse(s);

test('toDate handles ms, ISO and EJSON, drops out-of-range years', () => {
  assert.equal(toDate(ms('1971-03-02')), '1971-03-02');
  assert.equal(toDate('1971-03-02T00:00:00Z'), '1971-03-02');
  assert.equal(toDate({ $date: '1971-03-02T00:00:00Z' }), '1971-03-02');
  assert.equal(toDate(null), null);
  assert.equal(toDate('not-a-date'), null);
  // Year 20005 (the real corrupt value LF returned) -> dropped, not a crash.
  assert.equal(toDate(Date.UTC(20005, 0, 1)), null);
  assert.equal(toDate(Date.UTC(1800, 0, 1)), null);
});

test('mapDetailToPatch pulls DOB/weight/citizenship/gender', () => {
  const p = mapDetailToPatch({ birthday: ms('1971-03-02'), weight: 185, citizenship: 'USA', gender: 'M' });
  assert.deepEqual(p, { dob: '1971-03-02', weight_lbs: 185, citizenship: 'USA', gender: 'M' });
});

test('mapDetailToPatch maps documents by type (0=passport, 1=green card)', () => {
  const p = mapDetailToPatch({
    documents: [
      { type: 0, number: 'X1234567', country: 'USA', expiry: ms('2030-01-01') },
      { type: 1, number: 'GC999', expiry: ms('2031-06-01') },
      { type: 5, number: 'IGNORED' }, // re-entry permit, not mapped
    ],
  });
  assert.equal(p.passport_number, 'X1234567');
  assert.equal(p.passport_country, 'USA');
  assert.equal(p.passport_expiry, '2030-01-01');
  assert.equal(p.green_card_number, 'GC999');
  assert.equal(p.green_card_expiry, '2031-06-01');
  assert.equal(p.visa_number, undefined);
});

test('mapDetailToPatch drops a corrupt passport expiry without throwing', () => {
  const p = mapDetailToPatch({ documents: [{ type: 0, number: 'P1', expiry: Date.UTC(20005, 0, 1) }] });
  assert.equal(p.passport_number, 'P1');
  assert.equal(p.passport_expiry, undefined);
});

test('mapDetailToPatch is null-safe and empty for no data', () => {
  assert.deepEqual(mapDetailToPatch(null), {});
  assert.deepEqual(mapDetailToPatch({}), {});
});

test('mapListToPerson splits name + extracts oid; null when nameless', () => {
  const p = mapListToPerson({ _id: { $oid: 'abc' }, firstName: 'John', middleName: 'A', lastName: 'Smith', email: 'j@x.com' });
  assert.deepEqual(p, { lf_oid: 'abc', first_name: 'John', middle_name: 'A', last_name: 'Smith', email: 'j@x.com', origin: 'levelflight' });
  assert.equal(mapListToPerson({ _id: 'x' }), null);
});

test('extFor maps content types to extensions', () => {
  assert.equal(extFor('image/jpeg'), 'jpg');
  assert.equal(extFor('application/pdf'), 'pdf');
  assert.equal(extFor('image/png'), 'png');
  assert.equal(extFor('application/octet-stream'), 'bin');
});
