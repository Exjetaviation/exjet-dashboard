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

// Recompute the full breakdown from editable inputs + per-line $ overrides + ad-hoc Fees.
// `flightCost` (the per-leg computed value) is passed in; if absent we fall back to
// hourlyRate*hours (back-compat). `overrides` pins any line to a manual dollar amount.
// Taxable ad-hoc fees join the FET base; non-taxable fees are added after FET.
// `fetEnabled === false` disables FET. `totalOverride` (when set) wins over the total.
export const recomputeFromInputs = (i) => {
  const n = (v) => Number(v) || 0;
  const ov = (i.overrides && typeof i.overrides === 'object') ? i.overrides : {};
  const pinned = (k) => ov[k] !== undefined && ov[k] !== null && ov[k] !== '';
  const pin = (k, computed) => (pinned(k) ? Math.round(n(ov[k])) : computed);

  const baseFlight = (i.flightCost !== undefined && i.flightCost !== null && i.flightCost !== '')
    ? Math.round(n(i.flightCost)) : Math.round(n(i.hourlyRate) * n(i.hours));
  const flightCost = pin('flightCost', baseFlight);
  const surcharge = pin('surcharge', Math.round(n(i.surchargePerHr) * n(i.hours)));
  const faCost = pin('faCost', Math.round(n(i.faFee) * n(i.faCount)));
  const crewCost = pin('crewCost', Math.round(n(i.crewFee) * n(i.crewCount)));
  const landingCost = pin('landingCost', Math.round(n(i.landingFee) * n(i.landings)));
  const overnightComputed = (i.overnightRate !== undefined && i.overnightRate !== null)
    ? Math.round(Math.max(0, n(i.nights) - n(i.overnightThreshold)) * n(i.overnightRate))
    : Math.round(n(i.overnightCost));
  const overnightCost = pin('overnightCost', overnightComputed);
  const segmentFee = pin('segmentFee', Math.round(n(i.segmentPerPax) * n(i.pax)));

  const fees = Array.isArray(i.fees) ? i.fees : [];
  const feesTaxable = Math.round(fees.filter((f) => f.taxable).reduce((s, f) => s + n(f.amount), 0));
  const feesNonTaxable = Math.round(fees.filter((f) => !f.taxable).reduce((s, f) => s + n(f.amount), 0));

  const fetBase = flightCost + surcharge + landingCost + faCost + crewCost + overnightCost + feesTaxable;
  const fetEnabled = i.fetEnabled !== false;
  const fetAmount = fetEnabled ? Math.round(fetBase * n(i.fetRate)) : 0;
  const computedTotal = Math.round(fetBase + segmentFee + fetAmount + feesNonTaxable);

  const hasOverride = i.totalOverride !== null && i.totalOverride !== undefined && i.totalOverride !== '';
  const totalOverride = hasOverride ? Math.round(n(i.totalOverride)) : null;

  const hours = n(i.hours);
  const effectiveHourly = hours > 0 ? Math.round(flightCost / hours) : 0;

  return {
    flightCost, surcharge, faCost, crewCost, landingCost, overnightCost, segmentFee,
    fees, feesTaxable, feesNonTaxable,
    fetEnabled, fetBase: Math.round(fetBase), fetAmount,
    computedTotal, totalOverride, effectiveHourly,
    total: hasOverride ? totalOverride : computedTotal,
  };
};

// After a rate-card reprice (leg/aircraft/purpose change), keep the user's manual
// per-line $ overrides, ad-hoc fees, FET on/off, and total override; recompute so the
// override still wins. Returns the fresh base untouched when there were no manual edits.
export const repriceFromBase = (fresh, old = {}) => {
  const o = old && !old.error ? old : {};
  const ov = (o.overrides && typeof o.overrides === 'object') ? o.overrides : {};
  const hasManual = Object.keys(ov).length > 0
    || (Array.isArray(o.fees) && o.fees.length > 0)
    || (o.totalOverride !== null && o.totalOverride !== undefined && o.totalOverride !== '')
    || o.fetEnabled === false;
  if (!hasManual) return fresh;
  const inputs = {
    flightCost: fresh.flightCost,
    hourlyRate: fresh.hourlyRate, hours: fresh.hours, surchargePerHr: fresh.surchargePerHr,
    faFee: fresh.faFee, faCount: fresh.faCount, crewFee: fresh.crewFee, crewCount: fresh.crewCount,
    landingFee: fresh.landingFee, landings: fresh.landings,
    segmentPerPax: fresh.segmentPerPax, pax: fresh.pax, overnightCost: fresh.overnightCost,
    fetRate: fresh.fetRate,
    fees: Array.isArray(o.fees) ? o.fees : [],
    fetEnabled: o.fetEnabled !== false,
    totalOverride: o.totalOverride ?? null,
    overrides: ov,
  };
  return { ...fresh, ...inputs, ...recomputeFromInputs(inputs), overrides: ov, manual: true };
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
    costPerHr: rateCard.hourly_rate || 0,
    posRate: rateCard.positioning_rate || 0,
    flightCost: Math.round(flightCost),
    surchargePerHr: rateCard.surcharge_per_hr || 0, surcharge,
    landingFee: rateCard.landing_fee || 0, landings, landingCost,
    faFee: rateCard.fa_fee || 0, faCount, faCost,
    crewFee: rateCard.crew_fee || 0, crewCount, crewCost,
    nights, billableNights, overnightCost,
    overnightRate: rateCard.overnight_fee || 0, overnightThreshold: rateCard.overnight_threshold || 3,
    segmentPerPax: rateCard.segment_fee_per_pax || 0, pax: legs.reduce((s, l) => s + (l.pax || 0), 0), segmentFee,
    fetBase: Math.round(fetBase), fetRate: rateCard.fet_rate || 0, fetAmount,
    total,
    rateName: rateCard.label || rateCard.rate_name || rateCard.aircraft_tail,
    tail: rateCard.aircraft_tail,
  };
};

// Per-leg flight cost honoring nominal Cost/Hr (revenue legs) and Pos/Hr (ferry legs),
// with the rate card's min_hours / short_leg flooring. `rates` optionally overrides the
// card's hourly_rate / positioning_rate (when the user edits Cost/Hr or Pos/Hr).
// legs: [{ mins, isPositioning }]. Returns { flightCost, hours }.
export const computeFlightCost = (legs = [], rateCard = {}, rates = {}) => {
  const card = {
    ...rateCard,
    hourly_rate: rates.costPerHr != null && rates.costPerHr !== '' ? Number(rates.costPerHr) : rateCard.hourly_rate,
    positioning_rate: rates.posRate != null && rates.posRate !== '' ? Number(rates.posRate) : rateCard.positioning_rate,
  };
  const perLeg = legs.map((l) => calcLeg(l.mins, card, { isPositioning: !!l.isPositioning }));
  const flightCost = Math.round(perLeg.reduce((s, l) => s + l.cost, 0));
  const hours = Math.round(perLeg.reduce((s, l) => s + l.hrs, 0) * 100) / 100;
  return { flightCost, hours };
};
