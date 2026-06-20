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

// Recompute the full breakdown from editable RATE inputs (per-quote overrides:
// hourly rate, surcharge/hr, FA/crew fees + counts, hours, pax, …). Editing a
// rate — not a dollar total — reprices the quote, LevelFlight-style. Federal
// segment fee stays outside the FET base (same rule as priceTrip).
export const recomputeFromInputs = (i) => {
  const n = (v) => Number(v) || 0;
  const flightCost = Math.round(n(i.hourlyRate) * n(i.hours));
  const surcharge = Math.round(n(i.surchargePerHr) * n(i.hours));
  const faCost = Math.round(n(i.faFee) * n(i.faCount));
  const crewCost = Math.round(n(i.crewFee) * n(i.crewCount));
  const landingCost = Math.round(n(i.landingFee) * n(i.landings));
  const overnightCost = Math.round(n(i.overnightCost));
  const segmentFee = Math.round(n(i.segmentPerPax) * n(i.pax));
  const fetBase = flightCost + surcharge + landingCost + faCost + crewCost + overnightCost;
  const fetAmount = Math.round(fetBase * n(i.fetRate));
  return { flightCost, surcharge, faCost, crewCost, landingCost, overnightCost, segmentFee, fetBase: Math.round(fetBase), fetAmount, total: Math.round(fetBase + segmentFee + fetAmount) };
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
    perLeg, legs: legs.length, totalHrs, hours: totalHrs,
    hourlyRate: totalHrs > 0 ? Math.round(flightCost / totalHrs) : (rateCard.hourly_rate || 0),
    flightCost: Math.round(flightCost),
    surchargePerHr: rateCard.surcharge_per_hr || 0, surcharge,
    landingFee: rateCard.landing_fee || 0, landings, landingCost,
    faFee: rateCard.fa_fee || 0, faCount, faCost,
    crewFee: rateCard.crew_fee || 0, crewCount, crewCost,
    nights, billableNights, overnightCost,
    segmentPerPax: rateCard.segment_fee_per_pax || 0, pax: legs.reduce((s, l) => s + (l.pax || 0), 0), segmentFee,
    fetBase: Math.round(fetBase), fetRate: rateCard.fet_rate || 0, fetAmount,
    total,
    rateName: rateCard.rate_name || rateCard.aircraft_tail,
    tail: rateCard.aircraft_tail,
  };
};
