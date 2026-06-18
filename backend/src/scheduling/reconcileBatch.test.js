// backend/src/scheduling/reconcileBatch.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileBatch } from './reconcileBatch.js';

const NOW = '2026-06-18T19:00:00.000Z';

test('reconcileBatch reconciles each record against its existing row', () => {
  const incoming = [
    { lfOid: 'a', values: { status: 'booked' }, snapshot: { status: 'booked' } }, // new
    { lfOid: 'b', values: { status: 'booked' }, snapshot: { status: 'booked' } }, // clean update
    { lfOid: 'c', values: { status: 'booked' }, snapshot: { status: 'booked' } }, // locally modified
  ];
  const existingByOid = new Map([
    ['b', { locally_modified: false, lf_synced_snapshot: { status: 'quote' } }],
    ['c', { locally_modified: true, lf_synced_snapshot: { status: 'quote' } }],
  ]);

  const results = reconcileBatch(incoming, existingByOid, NOW);

  assert.equal(results.length, 3);
  assert.equal(results[0].action, 'insert');
  assert.equal(results[1].action, 'update');
  assert.equal(results[1].set.status, 'booked'); // working copy refreshed
  assert.equal('status' in results[2].set, false); // local edit preserved
  assert.equal(results[2].set.upstream_changed, true);
});

test('reconcileBatch returns an empty array for empty input', () => {
  assert.deepEqual(reconcileBatch([], new Map(), NOW), []);
});
