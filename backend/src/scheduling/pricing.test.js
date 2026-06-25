import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcLeg, priceTrip, recomputeFromInputs } from './pricing.js';

const rc = {
  aircraft_tail: 'N69FP', rate_name: 'GIV', hourly_rate: 9000, positioning_rate: 4500,
  min_hours: 1, short_leg_time: 0.5, short_leg_amount: 6000,
  overnight_fee: 1500, overnight_threshold: 3, segment_fee_per_pax: 50, fet_rate: 0.075,
};

test('calcLeg applies min hours, short-leg floor, and positioning rate', () => {
  assert.equal(calcLeg(120, rc).cost, 18000);                          // 2h * 9000
  assert.equal(calcLeg(20, rc).cost, 9000);                            // 1h min_hours floor (9000 > short-leg 6000)
  assert.equal(calcLeg(20, { ...rc, min_hours: 0 }).cost, 6000);       // short-leg floor when no min_hours
  assert.equal(calcLeg(120, rc, { isPositioning: true }).cost, 9000);  // 2h * 4500
});

test('priceTrip sums legs + fees; segment is outside the FET base', () => {
  const q = priceTrip({
    legs: [{ from: 'KFXE', to: 'KTEB', mins: 120, pax: 4 }, { from: 'KTEB', to: 'KFXE', mins: 120, pax: 4 }],
    rateCard: rc, nights: 4,
  });
  assert.equal(q.flightCost, 36000);
  assert.equal(q.billableNights, 1);
  assert.equal(q.overnightCost, 1500);
  assert.equal(q.segmentFee, 400);              // 50 * (4+4)
  assert.equal(q.fetBase, 37500);               // flight + overnight (no surcharge/fa/crew here); segment excluded
  assert.equal(q.fetAmount, 2813);              // round(37500 * 0.075)
  assert.equal(q.total, 40713);                 // 37500 + 400 + 2813
  assert.equal(q.tail, 'N69FP');
});

test('priceTrip reproduces the LevelFlight itemized quote', () => {
  const lf = {
    aircraft_tail: 'N69FP', hourly_rate: 9000, min_hours: 0,
    surcharge_per_hr: 1800, fa_fee: 700, crew_fee: 600, landing_fee: 0,
    segment_fee_per_pax: 5.30, fet_rate: 0.075, overnight_threshold: 3,
  };
  const q = priceTrip({ legs: [{ from: 'A', to: 'B', mins: 133, pax: 8 }], rateCard: lf, faCount: 1, crewCount: 1 });
  assert.equal(q.flightCost, 19950);   // 2:13 (133 min) * 9000/hr
  assert.equal(q.surcharge, 3990);     // 20% fuel surcharge
  assert.equal(q.faCost, 700);
  assert.equal(q.crewCost, 600);
  assert.equal(q.landingCost, 0);
  assert.equal(q.fetBase, 25240);
  assert.equal(q.fetAmount, 1893);     // 7.5% of 25,240
  assert.equal(q.segmentFee, 42);      // round(5.30 * 8), outside FET
  assert.equal(q.total, 27175);        // 25,240 + 42 + 1,893  (LevelFlight shows 27,175.40)
});

test('recomputeFromInputs reprices from rate inputs (edit hourly rate, not totals)', () => {
  const t = recomputeFromInputs({ hourlyRate: 9000, hours: 2.2167, surchargePerHr: 1800, faFee: 700, faCount: 1, crewFee: 600, crewCount: 1, landingFee: 0, landings: 1, segmentPerPax: 5.30, pax: 8, overnightCost: 0, fetRate: 0.075 });
  assert.equal(t.flightCost, 19950);   // 9000 * 2.2167h
  assert.equal(t.surcharge, 3990);     // 1800 * 2.2167h
  assert.equal(t.faCost, 700);
  assert.equal(t.crewCost, 600);
  assert.equal(t.fetBase, 25240);
  assert.equal(t.fetAmount, 1893);
  assert.equal(t.segmentFee, 42);
  assert.equal(t.total, 27175);
});

const baseInputs = {
  hourlyRate: 8500, hours: 2, surchargePerHr: 1800, faFee: 700, faCount: 1,
  crewFee: 0, crewCount: 0, landingFee: 0, landings: 2,
  segmentPerPax: 0, pax: 4, overnightCost: 1500, fetRate: 0.075,
};

test('taxable ad-hoc fee is added to the FET base', () => {
  const r = recomputeFromInputs({ ...baseInputs, fees: [{ amount: 1000, taxable: true }] });
  assert.equal(r.fetBase, 23800);
  assert.equal(r.fetAmount, Math.round(23800 * 0.075));
});

test('non-taxable fee is excluded from FET base but included in total', () => {
  const r = recomputeFromInputs({ ...baseInputs, fees: [{ amount: 1000, taxable: false }] });
  assert.equal(r.fetBase, 22800);
  assert.equal(r.total, r.computedTotal);
  assert.equal(r.total, 22800 + r.fetAmount + 1000);
});

test('FET toggle off zeroes the FET amount', () => {
  const r = recomputeFromInputs({ ...baseInputs, fetEnabled: false });
  assert.equal(r.fetAmount, 0);
});

test('totalOverride wins over the computed total', () => {
  const r = recomputeFromInputs({ ...baseInputs, totalOverride: 25000 });
  assert.equal(r.total, 25000);
  assert.equal(r.totalOverride, 25000);
  assert.notEqual(r.computedTotal, 25000);
});

test('default (no fees, no flags) keeps FET on — backward compatible', () => {
  const r = recomputeFromInputs(baseInputs);
  assert.equal(r.fetAmount, Math.round(r.fetBase * 0.075));
  assert.equal(r.totalOverride, null);
});

// ── repriceFromBase tests ────────────────────────────────────────────────────
import { repriceFromBase } from './pricing.js';

// A freshly-computed rate-card breakdown (the shape priceTrip/priceQuoteLegs returns).
const fresh = () => ({
  hourlyRate: 8000, hours: 5, surchargePerHr: 500, faFee: 0, faCount: 0,
  crewFee: 0, crewCount: 0, landingFee: 1000, landings: 2,
  segmentPerPax: 50, pax: 10, overnightCost: 0, fetRate: 0.075,
  flightCost: 40000, surcharge: 2500, landingCost: 2000, segmentFee: 500,
  fetBase: 44500, fetAmount: 3338, total: 48338, rateName: 'N69FP CHARTER', tail: 'N69FP',
});

test('repriceFromBase: no manual edits returns the fresh base unchanged', () => {
  const out = repriceFromBase(fresh(), {});
  assert.equal(out.total, 48338);
  assert.ok(!out.manual);
});

test('repriceFromBase: preserves a total override (override wins)', () => {
  const out = repriceFromBase(fresh(), { totalOverride: 60000 });
  assert.equal(out.totalOverride, 60000);
  assert.equal(out.total, 60000);
  assert.equal(out.manual, true);
});

test('repriceFromBase: preserves ad-hoc fees and adds them to the total', () => {
  const out = repriceFromBase(fresh(), { fees: [{ code: 'Catering', amount: 600, taxable: false }] });
  assert.equal(out.fees.length, 1);
  assert.equal(out.feesNonTaxable, 600);
  assert.equal(out.total, 48338 + 600); // non-taxable fee added after FET
  assert.equal(out.manual, true);
});

test('repriceFromBase: preserves FET off (owner)', () => {
  const out = repriceFromBase(fresh(), { fetEnabled: false });
  assert.equal(out.fetAmount, 0);
  assert.equal(out.total, 44500 + 500); // fetBase + segmentFee, no FET
  assert.equal(out.manual, true);
});
