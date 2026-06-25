import test from 'node:test';
import assert from 'node:assert/strict';
import { importFleet } from './lfAircraftImport.js';

const LF_LIST = [{ _id: { $oid: 'a1' }, tailNumber: 'N69FP', type: { name: 'GIV SP', engines: 2 } }];
const LF_DETAIL = {
  _id: { $oid: 'a1' }, tailNumber: 'N69FP', serial: '1180', type: { name: 'GIV SP', engines: 2 },
  cruiseSpeed: 464, fuelBurns: [4000, 3200, 3000], legacy: { time: 9544, cycles: 5579 },
  components: { engines: { 1: { _id: { $oid: 'e1' }, serial: '16463' } }, apu: { _id: { $oid: 'au' }, serial: 'P-542-C' } },
};

test('importFleet upserts each aircraft and its components, respecting locally_modified', async () => {
  const upsertedAircraft = []; const upsertedComps = [];
  const deps = {
    fetchList: async () => LF_LIST,
    fetchDetail: async () => LF_DETAIL,
    fetchTimes: async () => ({}),
    getExistingByTail: async () => ({ id: 'ac1', locally_modified: false }),
    upsertAircraft: async (row) => { upsertedAircraft.push(row); return { id: 'ac1', ...row }; },
    upsertComponent: async (row) => { upsertedComps.push(row); return { id: 'c', ...row }; },
  };
  const result = await importFleet(deps);
  assert.equal(result.aircraft, 1);
  assert.equal(upsertedAircraft[0].tail, 'N69FP');
  assert.equal(upsertedAircraft[0].cruise_speed_kt, 464);
  const positions = upsertedComps.map((c) => c.position).sort();
  assert.deepEqual(positions, ['airframe', 'apu', 'engine_1']);
  assert.equal(upsertedComps.find((c) => c.position === 'airframe').aircraft_id, 'ac1');
});

test('importFleet skips LF-sourced field overwrite when locally_modified', async () => {
  let patched = null;
  const deps = {
    fetchList: async () => LF_LIST, fetchDetail: async () => LF_DETAIL, fetchTimes: async () => ({}),
    getExistingByTail: async () => ({ id: 'ac1', locally_modified: true }),
    upsertAircraft: async (row) => { patched = row; return { id: 'ac1', ...row }; },
    upsertComponent: async () => ({ id: 'c' }),
  };
  await importFleet(deps);
  assert.equal(patched.locally_modified, true);
  assert.ok(patched.lf_synced_snapshot);
  assert.equal(patched.cruise_speed_kt, undefined);
});
