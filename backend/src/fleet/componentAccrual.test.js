import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLegEntries } from './componentAccrual.js';

const legId = '11111111-1111-1111-1111-111111111111';
const completedAt = '2026-06-20T02:00:00Z';
const fi = {
  status: 'complete', scheduling_leg_id: legId, completed_at: completedAt,
  off_at: '2026-06-19T23:25:00Z', on_at: '2026-06-20T01:38:00Z',  // 133 min flight
  out_at: '2026-06-19T23:15:00Z', in_at: '2026-06-20T01:44:00Z',  // 149 min block
  apu_start: 6900, apu_stop: 6902, apu_end_cycles: 12,
};
const baselineBefore = '2026-06-01T00:00:00Z';
const comps = [
  { id: 'af', position: 'airframe', accrues_flight_time: true, tracks_cycles: true, baseline_at: baselineBefore },
  { id: 'e1', position: 'engine_1', accrues_flight_time: true, tracks_cycles: true, baseline_at: baselineBefore },
  { id: 'apu', position: 'apu', accrues_flight_time: false, tracks_cycles: false, baseline_at: baselineBefore, apu_last_reading: 10 },
];

test('engines + airframe accrue Off->On hours and +1 cycle', () => {
  const rows = computeLegEntries(fi, comps);
  const af = rows.find((r) => r.component_id === 'af');
  assert.equal(Math.round(af.hours_delta * 60), 133);
  assert.equal(af.cycles_delta, 1);
  assert.equal(af.source, 'flight_info');
  assert.equal(af.leg_id, legId);
  assert.equal(af.time_source, 'crew');
  const e1 = rows.find((r) => r.component_id === 'e1');
  assert.equal(Math.round(e1.hours_delta * 60), 133);
});

test('APU accrues stop-start hours and running-total cycle delta', () => {
  const rows = computeLegEntries(fi, comps);
  const apu = rows.find((r) => r.component_id === 'apu');
  assert.equal(apu.hours_delta, 2);            // 6902 - 6900
  assert.equal(apu.cycles_delta, 2);           // 12 - 10 (previous reading)
});

test('baseline-date filter: legs completed before baseline_at are skipped', () => {
  const future = [{ ...comps[0], baseline_at: '2026-07-01T00:00:00Z' }];
  assert.deepEqual(computeLegEntries(fi, future), []);
});

test('draft flight info produces no entries', () => {
  assert.deepEqual(computeLegEntries({ ...fi, status: 'draft' }, comps), []);
});
