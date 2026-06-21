// backend/src/scheduling/peopleSearch.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankPeople } from './peopleSearch.js';

const PEOPLE = [
  { id: '1', first_name: 'John', last_name: 'Smith', dob: '1971-03-02' },
  { id: '2', first_name: 'Jane', last_name: 'Smithe', dob: '1989-11-20' },
  { id: '3', first_name: 'Aaron', last_name: 'Jones', dob: '1980-01-01' },
];

test('empty query returns everyone (capped)', () => {
  assert.equal(rankPeople(PEOPLE, '').length, 3);
  assert.equal(rankPeople(PEOPLE, '', 2).length, 2);
});

test('prefix match on a name part ranks above substring', () => {
  const r = rankPeople(PEOPLE, 'smi');
  assert.deepEqual(r.map((p) => p.id), ['1', '2']); // both match "Smith"/"Smithe", tie broken by name
});

test('matches a first name', () => {
  assert.deepEqual(rankPeople(PEOPLE, 'aaro').map((p) => p.id), ['3']);
});

test('matches DOB digits', () => {
  assert.deepEqual(rankPeople(PEOPLE, '1989').map((p) => p.id), ['2']);
});

test('no match returns empty', () => {
  assert.deepEqual(rankPeople(PEOPLE, 'zzz'), []);
});

test('null or undefined people list returns empty', () => {
  assert.deepEqual(rankPeople(null, 'john'), []);
  assert.deepEqual(rankPeople(undefined, 'john'), []);
});
