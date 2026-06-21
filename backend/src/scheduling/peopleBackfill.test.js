// backend/src/scheduling/peopleBackfill.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupPeople } from './peopleBackfill.js';

test('groups passenger rows into distinct people by name + dob', () => {
  const { people, passengerToKey } = groupPeople([
    { id: 'p1', name: 'John Smith', dob: '1971-03-02', weight_lbs: 185 },
    { id: 'p2', name: 'John Smith', dob: '1971-03-02', weight_lbs: 185 },  // same person, other trip
    { id: 'p3', name: 'John Smith', dob: '1989-11-20', weight_lbs: 160 },  // different DOB -> different person
  ]);
  assert.equal(people.length, 2);
  assert.equal(passengerToKey.p1, passengerToKey.p2);
  assert.notEqual(passengerToKey.p1, passengerToKey.p3);
  const john71 = people.find((x) => x.dob === '1971-03-02');
  assert.equal(john71.first_name, 'John');
  assert.equal(john71.last_name, 'Smith');
  assert.equal(john71.weight_lbs, 185);
});

test('null-DOB rows group by name only', () => {
  const { people } = groupPeople([
    { id: 'a', name: 'Jane Doe', dob: null, weight_lbs: null },
    { id: 'b', name: 'Jane Doe', dob: null, weight_lbs: 130 },
  ]);
  assert.equal(people.length, 1);
});

test('nameless rows are skipped', () => {
  const { people, passengerToKey } = groupPeople([{ id: 'x', name: '  ', dob: null }]);
  assert.equal(people.length, 0);
  assert.equal(passengerToKey.x, undefined);
});
