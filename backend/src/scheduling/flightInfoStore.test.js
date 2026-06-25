import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveMinutes, prefillFromBlock } from './flightInfoStore.js';

test('deriveMinutes computes flight and block minutes', () => {
  const fi = { off_at: '2026-06-19T23:25:00Z', on_at: '2026-06-20T01:38:00Z',
               out_at: '2026-06-19T23:15:00Z', in_at: '2026-06-20T01:44:00Z' };
  const d = deriveMinutes(fi);
  assert.equal(d.flight_minutes, 133);
  assert.equal(d.block_minutes, 149);
});

test('prefillFromBlock maps LF block OOOI (epoch ms) to ISO fields', () => {
  const block = { out: 1750000000000, off: 1750000600000, on: 1750007980000, in: 1750008340000 };
  const pre = prefillFromBlock(block);
  assert.equal(pre.out_at, new Date(1750000000000).toISOString());
  assert.equal(pre.on_at, new Date(1750007980000).toISOString());
});

test('prefillFromBlock returns empty object when no block', () => {
  assert.deepEqual(prefillFromBlock(null), {});
});
