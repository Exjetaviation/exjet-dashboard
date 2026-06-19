import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcLeg, priceTrip } from './pricing.js';

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

test('priceTrip sums legs, fees, and FET like quoteEngine', () => {
  const q = priceTrip({
    legs: [{ from: 'KFXE', to: 'KTEB', mins: 120, pax: 4 }, { from: 'KTEB', to: 'KFXE', mins: 120, pax: 4 }],
    rateCard: rc, nights: 4,
  });
  assert.equal(q.flightCost, 36000);
  assert.equal(q.billableNights, 1);
  assert.equal(q.overnightCost, 1500);
  assert.equal(q.segmentFee, 400);              // 50 * (4+4)
  assert.equal(q.subtotal, 37900);
  assert.equal(q.fetAmount, 2843);              // round(37900 * 0.075)
  assert.equal(q.total, 40743);
  assert.equal(q.tail, 'N69FP');
});
