import { test } from 'node:test';
import assert from 'node:assert/strict';
import { delaySegments } from './delaySegments.js';

const MIN = 60000;
const dep = 1_000_000;
const arr = dep + 120 * MIN;
const settled = { dep, arr, now: arr + 200 * MIN }; // "now" well past, for settled cases

test('late departure (persisted) -> red dep segment dep..actualDep', () => {
  const d = delaySegments({ ...settled, actualDep: dep + 20 * MIN, depSource: 'exact' }).find((s) => s.edge === 'dep');
  assert.equal(d.kind, 'late'); assert.equal(d.from, dep); assert.equal(d.to, dep + 20 * MIN); assert.equal(d.approx, false);
});

test('early departure -> green segment actualDep..dep', () => {
  const d = delaySegments({ ...settled, actualDep: dep - 15 * MIN }).find((s) => s.edge === 'dep');
  assert.equal(d.kind, 'early'); assert.equal(d.from, dep - 15 * MIN); assert.equal(d.to, dep);
});

test('sub-threshold delta (<5 min) -> no segment', () => {
  assert.equal(delaySegments({ ...settled, actualDep: dep + 3 * MIN }).length, 0);
});

test('live undeparted: on the ground past dep -> red dep segment growing to now', () => {
  const now = dep + 18 * MIN;
  const d = delaySegments({ dep, arr, now, onGround: true }).find((s) => s.edge === 'dep');
  assert.equal(d.kind, 'late'); assert.equal(d.to, now); assert.equal(d.live, true);
});

test('live airborne past scheduled arrival -> red arr segment growing to now', () => {
  const now = arr + 25 * MIN;
  const a = delaySegments({ dep, arr, now, airborne: true }).find((s) => s.edge === 'arr');
  assert.equal(a.kind, 'late'); assert.equal(a.from, arr); assert.equal(a.to, now); assert.equal(a.live, true);
});

test('live wheels-up time used for departure when airborne and no persisted actual', () => {
  const d = delaySegments({ dep, arr, now: arr, airborne: true, airborneSinceMs: dep + 30 * MIN }).find((s) => s.edge === 'dep');
  assert.equal(d.kind, 'late'); assert.equal(d.to, dep + 30 * MIN);
});

test('approx source flags the segment as approximate', () => {
  const a = delaySegments({ ...settled, actualArr: arr + 40 * MIN, arrSource: 'approx' }).find((s) => s.edge === 'arr');
  assert.equal(a.approx, true);
});

test('on-time leg -> no segments', () => {
  assert.equal(delaySegments({ ...settled, actualDep: dep + 1 * MIN, actualArr: arr - 2 * MIN }).length, 0);
});
