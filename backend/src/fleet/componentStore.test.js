import test from 'node:test';
import assert from 'node:assert/strict';
import { totalsFromEntries } from './componentStore.js';

test('totalsFromEntries sums baseline + ledger deltas', () => {
  const comp = { baseline_hours: 9000, baseline_cycles: 5000 };
  const entries = [
    { hours_delta: 2.2, cycles_delta: 1 },
    { hours_delta: 1.5, cycles_delta: 1 },
  ];
  const t = totalsFromEntries(comp, entries);
  assert.equal(t.total_hours, 9003.7);
  assert.equal(t.total_cycles, 5002);
});

test('totalsFromEntries with no entries returns baseline', () => {
  const t = totalsFromEntries({ baseline_hours: 100, baseline_cycles: 7 }, []);
  assert.equal(t.total_hours, 100);
  assert.equal(t.total_cycles, 7);
});
