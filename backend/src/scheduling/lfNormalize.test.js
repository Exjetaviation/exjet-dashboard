// backend/src/scheduling/lfNormalize.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oidToStr, toIsoTimestamp, unwrapArray } from './lfNormalize.js';

test('oidToStr handles EJSON $oid, strings, numbers, and empties', () => {
  assert.equal(oidToStr({ $oid: 'abc123' }), 'abc123');
  assert.equal(oidToStr('plain'), 'plain');
  assert.equal(oidToStr(42), '42');
  assert.equal(oidToStr(null), null);
  assert.equal(oidToStr(undefined), null);
  assert.equal(oidToStr({}), null);
});

test('toIsoTimestamp handles ms, sec, ISO, numeric strings, Date, and junk', () => {
  const ms = 1765207800000;
  const expected = new Date(ms).toISOString();
  assert.equal(toIsoTimestamp(ms), expected);
  assert.equal(toIsoTimestamp(ms / 1000), expected);            // seconds upscaled to ms
  assert.equal(toIsoTimestamp(String(ms)), expected);            // numeric string
  assert.equal(toIsoTimestamp('2026-06-18T19:00:00.000Z'), '2026-06-18T19:00:00.000Z');
  assert.equal(toIsoTimestamp(new Date(ms)), expected);
  assert.equal(toIsoTimestamp(null), null);
  assert.equal(toIsoTimestamp(''), null);
  assert.equal(toIsoTimestamp('not-a-date'), null);
});

test('unwrapArray returns bare arrays and unwraps known keys', () => {
  assert.deepEqual(unwrapArray([1, 2], ['legs']), [1, 2]);
  assert.deepEqual(unwrapArray({ legs: [3] }, ['legs', 'data']), [3]);
  assert.throws(() => unwrapArray({ nope: 1 }, ['legs']), /unexpected LevelFlight list shape/);
});
