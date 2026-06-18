// backend/src/scheduling/reconcile.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stableStringify, snapshotsEqual, reconcileRecord } from './reconcile.js';

const NOW = '2026-06-18T19:00:00.000Z';

test('stableStringify is key-order independent', () => {
  assert.equal(stableStringify({ a: 1, b: 2 }), stableStringify({ b: 2, a: 1 }));
  assert.equal(snapshotsEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }), true);
  assert.equal(snapshotsEqual({ a: 1 }, { a: 2 }), false);
});

test('reconcileRecord inserts a brand-new mirrored record', () => {
  const incoming = {
    lfOid: 'lf1',
    values: { status: 'booked', trip_number: '25104' },
    snapshot: { status: 'booked', trip_number: '25104' },
  };
  const result = reconcileRecord(incoming, null, NOW);
  assert.equal(result.action, 'insert');
  assert.deepEqual(result.set, {
    lf_oid: 'lf1',
    status: 'booked',
    trip_number: '25104',
    origin: 'levelflight',
    lf_synced_snapshot: { status: 'booked', trip_number: '25104' },
    locally_modified: false,
    upstream_changed: false,
    synced_at: NOW,
  });
});

test('reconcileRecord mirrors the working copy when not locally modified', () => {
  const incoming = {
    lfOid: 'lf1',
    values: { status: 'booked', trip_number: '25104' },
    snapshot: { status: 'booked', trip_number: '25104' },
  };
  const existing = { locally_modified: false, lf_synced_snapshot: { status: 'quote' } };
  const result = reconcileRecord(incoming, existing, NOW);
  assert.equal(result.action, 'update');
  assert.deepEqual(result.set, {
    lf_oid: 'lf1',
    status: 'booked',
    trip_number: '25104',
    lf_synced_snapshot: { status: 'booked', trip_number: '25104' },
    upstream_changed: false,
    synced_at: NOW,
  });
});

test('reconcileRecord never overwrites a locally modified working copy', () => {
  const incoming = {
    lfOid: 'lf1',
    values: { status: 'booked' },
    snapshot: { status: 'booked' },
  };
  const existing = { locally_modified: true, lf_synced_snapshot: { status: 'quote' } };
  const result = reconcileRecord(incoming, existing, NOW);
  // No working-copy fields (no `status`) in the set — only snapshot/flags/time.
  assert.deepEqual(result.set, {
    lf_oid: 'lf1',
    lf_synced_snapshot: { status: 'booked' },
    upstream_changed: true, // snapshot changed quote -> booked
    synced_at: NOW,
  });
});

test('reconcileRecord does not flag upstream_changed when snapshot is unchanged', () => {
  const incoming = {
    lfOid: 'lf1',
    values: { status: 'booked' },
    snapshot: { status: 'quote' },
  };
  const existing = { locally_modified: true, lf_synced_snapshot: { status: 'quote' } };
  const result = reconcileRecord(incoming, existing, NOW);
  assert.equal(result.set.upstream_changed, false);
  assert.equal('status' in result.set, false);
});

test('reconcileRecord keeps upstream_changed sticky once set', () => {
  const incoming = { lfOid: 'lf1', values: { status: 'booked' }, snapshot: { status: 'quote' } };
  const existing = { locally_modified: true, upstream_changed: true, lf_synced_snapshot: { status: 'quote' } };
  const result = reconcileRecord(incoming, existing, NOW);
  // snapshot is unchanged, but the flag was already set — it must stay true.
  assert.equal(result.set.upstream_changed, true);
});
