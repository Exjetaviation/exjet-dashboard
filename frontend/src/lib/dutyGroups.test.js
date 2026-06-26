import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupDutiesByStart } from './dutyGroups.js';

const M = 60000; // one minute in ms

test('groupDutiesByStart: crew starting within the gap merge into one bracket', () => {
  const duties = [{ _start: 0, role: 'PIC' }, { _start: 10 * M, role: 'SIC' }];
  const groups = groupDutiesByStart(duties, 15 * M);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 2);
});

test('groupDutiesByStart: crew starting more than the gap apart get separate brackets', () => {
  const duties = [{ _start: 0, role: 'PIC' }, { _start: 20 * M, role: 'SIC' }];
  const groups = groupDutiesByStart(duties, 15 * M);
  assert.equal(groups.length, 2);
  assert.equal(groups[0][0].role, 'PIC');
  assert.equal(groups[1][0].role, 'SIC');
});

test('groupDutiesByStart: exactly at the gap still merges (inclusive boundary)', () => {
  const duties = [{ _start: 0 }, { _start: 15 * M }];
  assert.equal(groupDutiesByStart(duties, 15 * M).length, 1);
});

test('groupDutiesByStart: sorts by start before grouping (input order independent)', () => {
  const duties = [{ _start: 20 * M, role: 'SIC' }, { _start: 0, role: 'PIC' }];
  const groups = groupDutiesByStart(duties, 15 * M);
  assert.equal(groups.length, 2);
  assert.equal(groups[0][0].role, 'PIC'); // earliest first
});

test('groupDutiesByStart: empty / missing input → []', () => {
  assert.deepEqual(groupDutiesByStart([], 15 * M), []);
  assert.deepEqual(groupDutiesByStart(undefined, 15 * M), []);
});
