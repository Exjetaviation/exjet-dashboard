// backend/src/services/flightTrackStore.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Force the soft-fail path: no Supabase config. Point dotenv at an empty file so
// importing the module can't repopulate the vars from a local .env.
process.env.DOTENV_CONFIG_PATH = '/dev/null';
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;

const { getFlightTrack, getStoredLegIds, upsertFlightTrack } = await import('./flightTrackStore.js');

test('getFlightTrack returns null with no Supabase', async () => {
  assert.equal(await getFlightTrack('leg1'), null);
});

test('getStoredLegIds returns an empty Set with no Supabase', async () => {
  const s = await getStoredLegIds(['a', 'b']);
  assert.ok(s instanceof Set);
  assert.equal(s.size, 0);
});

test('upsertFlightTrack returns null with no Supabase', async () => {
  assert.equal(await upsertFlightTrack({ leg_id: 'x' }), null);
});
