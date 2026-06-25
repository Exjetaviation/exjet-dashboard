import test from 'node:test';
import assert from 'node:assert/strict';
import { accrueLeg } from './accrueLeg.js';

test('accrueLeg resolves aircraft by tail and applies one entry per accruing component', async () => {
  const applied = [];
  const fi = { status: 'complete', scheduling_leg_id: 'L1', completed_at: '2026-06-20T02:00:00Z',
               off_at: '2026-06-19T23:25:00Z', on_at: '2026-06-20T01:38:00Z' };
  const deps = {
    getAircraftByTail: async (t) => (t === 'N69FP' ? { id: 'ac1' } : null),
    listComponents: async () => ([
      { id: 'af', component_type: 'airframe', position: 'airframe', accrues_flight_time: true, tracks_cycles: true, baseline_at: '2026-06-01T00:00:00Z' },
      { id: 'e1', component_type: 'engine', position: 'engine_1', accrues_flight_time: true, tracks_cycles: true, baseline_at: '2026-06-01T00:00:00Z' },
    ]),
    applyLedgerEntry: async (e) => { applied.push(e); },
  };
  const n = await accrueLeg(deps, fi, 'N69FP');
  assert.equal(n, 2);
  assert.deepEqual(applied.map((e) => e.component_id).sort(), ['af', 'e1']);
});

test('accrueLeg returns 0 when tail has no aircraft row', async () => {
  const deps = { getAircraftByTail: async () => null, listComponents: async () => [], applyLedgerEntry: async () => {} };
  assert.equal(await accrueLeg(deps, { status: 'complete', scheduling_leg_id: 'L1' }, 'ZZZ'), 0);
});
