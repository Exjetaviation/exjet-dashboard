// backend/src/services/lfUserDirectory.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexUsers } from './lfUserDirectory.js';

test('indexes oid -> { email, name } across multiple lists', () => {
  const users = [{ _id: { $oid: 'u1' }, firstName: 'Ann', lastName: 'P', email: 'ann@x.com' }];
  const pilots = { pilots: [{ _id: { $oid: 'u2' }, firstName: 'Bo', emailAddress: 'bo@x.com' }] };
  const map = indexUsers([users, pilots]);
  assert.equal(map.get('u1').email, 'ann@x.com');
  assert.equal(map.get('u1').name, 'Ann P');
  assert.equal(map.get('u2').email, 'bo@x.com');
});

test('prefers the entry that has an email when oid repeats; skips oid-less rows', () => {
  const a = [{ _id: { $oid: 'u1' }, firstName: 'Ann' }];            // no email
  const b = [{ _id: { $oid: 'u1' }, email: 'ann@x.com' }, { name: 'x' }];
  const map = indexUsers([a, b]);
  assert.equal(map.get('u1').email, 'ann@x.com');
  assert.equal(map.size, 1);
});
