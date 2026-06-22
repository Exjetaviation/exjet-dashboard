// Pure mirror of the backend recomputeFromInputs (backend/src/scheduling/pricing.js).
// Keep this in lockstep with the backend so the on-screen total equals the persisted
// pricing.total. Taxable ad-hoc fees join the FET base; non-taxable fees are added
// after FET. fetEnabled===false disables FET. totalOverride (when set) wins.
export const recomputeInputs = (i) => {
  const n = (v) => Number(v) || 0;
  const flightCost = Math.round(n(i.hourlyRate) * n(i.hours));
  const surcharge = Math.round(n(i.surchargePerHr) * n(i.hours));
  const faCost = Math.round(n(i.faFee) * n(i.faCount));
  const crewCost = Math.round(n(i.crewFee) * n(i.crewCount));
  const landingCost = Math.round(n(i.landingFee) * n(i.landings));
  const overnightCost = Math.round(n(i.overnightCost));
  const segmentFee = Math.round(n(i.segmentPerPax) * n(i.pax));

  const fees = Array.isArray(i.fees) ? i.fees : [];
  const feesTaxable = Math.round(fees.filter((f) => f.taxable).reduce((s, f) => s + n(f.amount), 0));
  const feesNonTaxable = Math.round(fees.filter((f) => !f.taxable).reduce((s, f) => s + n(f.amount), 0));

  const fetBase = flightCost + surcharge + landingCost + faCost + crewCost + overnightCost + feesTaxable;
  const fetEnabled = i.fetEnabled !== false;
  const fetAmount = fetEnabled ? Math.round(fetBase * n(i.fetRate)) : 0;
  const computedTotal = Math.round(fetBase + segmentFee + fetAmount + feesNonTaxable);

  const hasOverride = i.totalOverride !== null && i.totalOverride !== undefined && i.totalOverride !== '';
  const totalOverride = hasOverride ? Math.round(n(i.totalOverride)) : null;

  return {
    flightCost, surcharge, faCost, crewCost, landingCost, overnightCost, segmentFee,
    fees, feesTaxable, feesNonTaxable,
    fetEnabled, fetBase: Math.round(fetBase), fetAmount,
    computedTotal, totalOverride,
    total: hasOverride ? totalOverride : computedTotal,
  };
};
