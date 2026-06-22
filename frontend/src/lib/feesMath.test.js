import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recomputeInputs } from './feesMath.js';

const base = {
  hourlyRate: 8500, hours: 2, surchargePerHr: 1800, faFee: 700, faCount: 1,
  crewFee: 0, crewCount: 0, landingFee: 0, landings: 2,
  segmentPerPax: 0, pax: 4, overnightCost: 1500, fetRate: 0.075,
};

test('taxable ad-hoc fee joins the FET base', () => {
  const r = recomputeInputs({ ...base, fees: [{ amount: 1000, taxable: true }] });
  assert.equal(r.fetBase, 23800);
  assert.equal(r.fetAmount, Math.round(23800 * 0.075));
});
test('non-taxable fee excluded from FET base, added to total', () => {
  const r = recomputeInputs({ ...base, fees: [{ amount: 1000, taxable: false }] });
  assert.equal(r.fetBase, 22800);
  assert.equal(r.total, 22800 + r.fetAmount + 1000);
});
test('FET toggle off zeroes FET', () => {
  assert.equal(recomputeInputs({ ...base, fetEnabled: false }).fetAmount, 0);
});
test('totalOverride wins', () => {
  const r = recomputeInputs({ ...base, totalOverride: 25000 });
  assert.equal(r.total, 25000);
  assert.equal(r.totalOverride, 25000);
  assert.notEqual(r.computedTotal, 25000);
});
test('default keeps FET on (backward compatible)', () => {
  const r = recomputeInputs(base);
  assert.equal(r.fetAmount, Math.round(r.fetBase * 0.075));
  assert.equal(r.totalOverride, null);
});
