// Single source of truth for rate-card pricing. The per-leg math is the same as
// the original quoteEngine.calcLeg; priceTrip generalizes calculateTripQuote to N
// legs with optional positioning legs.
export const calcLeg = (mins, rateCard, { isPositioning = false } = {}) => {
  const hrs = mins / 60;
  const rate = isPositioning && rateCard.positioning_rate > 0 ? rateCard.positioning_rate : rateCard.hourly_rate;
  const applyMin = rateCard.min_hours > 0 ? Math.max(hrs, rateCard.min_hours) : hrs;
  let cost = applyMin * rate;
  if (rateCard.short_leg_time > 0 && hrs < rateCard.short_leg_time) {
    cost = Math.max(cost, rateCard.short_leg_amount || 0);
  }
  return { hrs: Math.round(hrs * 100) / 100, mins, cost: Math.round(cost) };
};

// legs: [{ from, to, mins, pax, isPositioning }]
export const priceTrip = ({ legs, rateCard, nights = 0 }) => {
  const perLeg = legs.map((l) => ({
    from: l.from, to: l.to, source: l.source,
    ...calcLeg(l.mins, rateCard, { isPositioning: l.isPositioning }),
  }));
  const flightCost = perLeg.reduce((s, l) => s + l.cost, 0);
  const totalHrs = Math.round(perLeg.reduce((s, l) => s + l.hrs, 0) * 100) / 100;
  const billableNights = Math.max(0, nights - (rateCard.overnight_threshold || 3));
  const overnightCost = billableNights * (rateCard.overnight_fee || 0);
  const segmentFee = (rateCard.segment_fee_per_pax || 0) * legs.reduce((s, l) => s + (l.pax || 0), 0);
  const subtotal = flightCost + overnightCost + segmentFee;
  const fetAmount = subtotal * (rateCard.fet_rate || 0);
  return {
    perLeg, legs: legs.length, totalHrs,
    flightCost: Math.round(flightCost),
    nights, billableNights, overnightCost: Math.round(overnightCost),
    segmentFee: Math.round(segmentFee),
    subtotal: Math.round(subtotal),
    fetRate: rateCard.fet_rate || 0,
    fetAmount: Math.round(fetAmount),
    total: Math.round(subtotal + fetAmount),
    rateName: rateCard.rate_name || rateCard.aircraft_tail,
    tail: rateCard.aircraft_tail,
  };
};
