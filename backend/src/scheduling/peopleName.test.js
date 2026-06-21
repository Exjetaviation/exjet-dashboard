// backend/src/scheduling/peopleName.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayName, identityKey, splitLegacyName } from './peopleName.js';

test('displayName joins present name parts', () => {
  assert.equal(displayName({ first_name: 'John', middle_name: 'A', last_name: 'Smith' }), 'John A Smith');
  assert.equal(displayName({ first_name: 'John', last_name: 'Smith' }), 'John Smith');
  assert.equal(displayName({ first_name: 'Cher' }), 'Cher');
  assert.equal(displayName({}), '');
  assert.equal(displayName(null), '');
  assert.equal(displayName(undefined), '');
});

test('identityKey lowercases name and appends dob when present', () => {
  assert.equal(identityKey('John Smith', '1971-03-02'), 'john smith|1971-03-02');
  assert.equal(identityKey('  John Smith ', null), 'john smith');
  assert.equal(identityKey('   ', null), '');
});

test('splitLegacyName splits first / middle / last', () => {
  assert.deepEqual(splitLegacyName('John Smith'), { first_name: 'John', middle_name: '', last_name: 'Smith' });
  assert.deepEqual(splitLegacyName('John A Smith'), { first_name: 'John', middle_name: 'A', last_name: 'Smith' });
  assert.deepEqual(splitLegacyName('John Adam B Smith'), { first_name: 'John', middle_name: 'Adam B', last_name: 'Smith' });
  assert.deepEqual(splitLegacyName('Cher'), { first_name: 'Cher', middle_name: '', last_name: '' });
});
