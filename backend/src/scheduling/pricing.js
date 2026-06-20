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

// Recompute FET + total from (possibly hand-edited) line amounts — used when a
// quote's pricing is adjusted per-line, so the tax + total stay consistent. The
// federal segment fee stays outside the FET base (same rule as priceTrip).
export const recomputeTotals = (lines, fetRate = 0) => {
  const n = (v) => Number(v) || 0;
  const fetBase = n(lines.flightCost) + n(lines.surcharge) + n(lines.landingCost) + n(lines.faCost) + n(lines.crewCost) + n(lines.overnightCost);
  const fetAmount = Math.round(fetBase * (Number(fetRate) || 0));
  return { fetBase: Math.round(fetBase), fetAmount, total: Math.round(fetBase + n(lines.segmentFee) + fetAmount) };
};

// legs: [{ from, to, mins, pax, isPositioning }]
// Itemized like LevelFlight: flight cost, fuel surcharge, landings, FA, crew,
// overnights, segment fee, FET. FET (the federal air-transportation excise) is
// charged on the transportation total; the federal segment fee sits OUTSIDE it.
export const priceTrip = ({ legs, rateCard, nights = 0, faCount = 1, crewCount = 1 }) => {
  const perLeg = legs.map((l) => ({
    from: l.from, to: l.to, source: l.source,
    ...calcLeg(l.mins, rateCard, { isPositioning: l.isPositioning }),
  }));
  const flightCost = perLeg.reduce((s, l) => s + l.cost, 0);
  const totalHrs = Math.round(perLeg.reduce((s, l) => s + l.hrs, 0) * 100) / 100;

  const rawHrs = legs.reduce((s, l) => s + (l.mins || 0), 0) / 60;            // unrounded, for precise surcharge
  const surcharge = Math.round(rawHrs * (rateCard.surcharge_per_hr || 0));     // fuel surcharge, $/flight hour (LevelFlight model)
  const landings = legs.length;
  const landingCost = Math.round(landings * (rateCard.landing_fee || 0));
  const faCost = Math.round((faCount || 0) * (rateCard.fa_fee || 0));
  const crewCost = Math.round((crewCount || 0) * (rateCard.crew_fee || 0));
  const billableNights = Math.max(0, nights - (rateCard.overnight_threshold || 3));
  const overnightCost = Math.round(billableNights * (rateCard.overnight_fee || 0));

  // Federal segment fee is a separate tax — NOT part of the FET base.
  const segmentFee = Math.round((rateCard.segment_fee_per_pax || 0) * legs.reduce((s, l) => s + (l.pax || 0), 0));

  const fetBase = flightCost + surcharge + landingCost + faCost + crewCost + overnightCost;
  const fetAmount = Math.round(fetBase * (rateCard.fet_rate || 0));
  const total = Math.round(fetBase + segmentFee + fetAmount);

  return {
    perLeg, legs: legs.length, totalHrs,
    flightCost: Math.round(flightCost),
    surchargePerHr: rateCard.surcharge_per_hr || 0, surcharge,
    landings, landingCost,
    faCount, faCost, crewCount, crewCost,
    nights, billableNights, overnightCost,
    segmentFee,
    fetBase: Math.round(fetBase), fetRate: rateCard.fet_rate || 0, fetAmount,
    total,
    rateName: rateCard.rate_name || rateCard.aircraft_tail,
    tail: rateCard.aircraft_tail,
  };
};
