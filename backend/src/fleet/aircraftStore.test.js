import test from 'node:test';
import assert from 'node:assert/strict';
import { listAircraft, upsertAircraftByTail } from './aircraftStore.js';

function fakeSupabase(rows = []) {
  const calls = [];
  return {
    calls,
    from() { return this; },
    select() { calls.push('select'); return { data: rows, error: null,
      order() { return { data: rows, error: null }; } }; },
    upsert(payload, opts) { calls.push(['upsert', payload, opts]); return {
      select() { return { single() { return { data: { id: 'x', ...(Array.isArray(payload) ? payload[0] : payload) }, error: null }; } }; } }; },
  };
}

test('listAircraft returns [] when supabase is null (soft-fail)', async () => {
  assert.deepEqual(await listAircraft(null), []);
});

test('upsertAircraftByTail conflicts on tail', async () => {
  const sb = fakeSupabase();
  await upsertAircraftByTail(sb, { tail: 'N69FP', origin: 'levelflight' });
  const upsertCall = sb.calls.find((c) => Array.isArray(c) && c[0] === 'upsert');
  assert.equal(upsertCall[2].onConflict, 'tail');
});
