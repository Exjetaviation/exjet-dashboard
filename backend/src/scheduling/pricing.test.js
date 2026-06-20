import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcLeg, priceTrip, recomputeTotals } from './pricing.js';

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

test('recomputeTotals keeps FET + total consistent after per-line edits', () => {
  const t = recomputeTotals({ flightCost: 19950, surcharge: 3990, landingCost: 0, faCost: 700, crewCost: 600, overnightCost: 0, segmentFee: 42 }, 0.075);
  assert.equal(t.fetBase, 25240);
  assert.equal(t.fetAmount, 1893);
  assert.equal(t.total, 27175);
});
