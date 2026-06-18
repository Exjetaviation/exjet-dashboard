// Pure mapper: LevelFlight dispatch -> quote view-model the renderer consumes.
// No I/O. The dollar total is taken ONLY from LevelFlight; null when absent
// (never fabricated). acceptId drives the LevelFlight client accept/sign link.
//
// A /api/dispatch/list dispatch carries the route as a comma-separated airport
// string in `_internal.summary` (e.g. "KFXE, MDLR, KTMB, KFXE") with overall
// `_internal.order`/`_internal.end` timestamps — NOT a detailed legs[] array.
// We build consecutive-pair legs from the summary. Per-leg distance/pax/times
// aren't in this payload (only the trip's first-departure/last-arrival times).
// A legs[] fallback is kept for any payload that does include detailed legs.

const oid = (v) => (v && typeof v === 'object' ? v.$oid : v) || null;

export function mapDispatchToQuote(d) {
  const dispatchId = oid(d?._id);
  const internal = d?._internal || {};
  const total = internal?.price?.breakdown?.calculatedTotal
    ?? internal?.price?.total
    ?? null;

  const depTime = internal?.order ?? null;
  const arrTime = internal?.end ?? null;

  const airports = String(internal?.summary || '')
    .split(',').map((s) => s.trim()).filter(Boolean);

  let legs = [];
  for (let i = 0; i + 1 < airports.length; i++) {
    legs.push({
      from: airports[i],
      to: airports[i + 1],
      depTime: i === 0 ? depTime : null,                 // only trip-level times available
      arrTime: i === airports.length - 2 ? arrTime : null,
      distance: null,
      pax: null,
    });
  }

  // Fallback: a payload that DOES carry detailed legs (other LF endpoints).
  if (!legs.length && Array.isArray(d?.legs)) {
    legs = d.legs.map((l) => ({
      from: l?.departure?.airport ?? null,
      to: l?.arrival?.airport ?? null,
      depTime: l?.departure?.time ?? null,
      arrTime: l?.arrival?.time ?? null,
      distance: l?.distance ?? null,
      pax: l?.pax ?? l?.passengers ?? null,
    }));
  }

  return {
    dispatchId,
    acceptId: d?.clientAcceptId || dispatchId,
    quoteNumber: d?.quoteId != null ? String(d.quoteId) : null,
    tail: d?.aircraft?.tailNumber ?? null,
    aircraftType: d?.aircraft?.type?.name ?? null,
    maxPax: d?.aircraft?.paxSeats ?? null,
    total,
    depTime,
    arrTime,
    legs,
  };
}

// Map ONE full LevelFlight leg (from getTripLog().dispatch.legs) to a quote leg —
// with per-leg airports, times, distance, EFT, pax, and inline coordinates from
// _calc.from/to.location (the same source the flights-page map uses).
export function mapLegDetail(l) {
  const loc = (x) => (x && x.lat != null && x.lng != null) ? [x.lat, x.lng] : null;
  return {
    from: l?.departure?.airport ?? null,
    to: l?.arrival?.airport ?? null,
    depTime: l?.departure?.time ?? null,
    arrTime: l?.arrival?.time ?? null,
    distance: l?._calc?.distance?.value ?? null,
    eft: l?._calc?.time ?? null,
    pax: l?.passengerCount ?? null,
    fromLatLng: loc(l?._calc?.from?.location),
    toLatLng: loc(l?._calc?.to?.location),
  };
}
