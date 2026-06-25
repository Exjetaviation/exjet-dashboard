// Pure mirror of the backend recomputeFromInputs (backend/src/scheduling/pricing.js).
// Keep this in lockstep with the backend so the on-screen total equals the persisted
// pricing.total. Taxable ad-hoc fees join the FET base; non-taxable fees are added
// after FET. fetEnabled===false disables FET. totalOverride (when set) wins.
// `flightCost` (the per-leg computed value) is passed in; if absent we fall back to
// hourlyRate*hours (back-compat). `overrides` pins any line to a manual dollar amount.
export const recomputeInputs = (i) => {
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
