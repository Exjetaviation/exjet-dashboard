// Pure mapper: LevelFlight dispatch -> quote view-model the renderer consumes.
// No I/O. The dollar total is taken ONLY from LevelFlight; null when absent
// (never fabricated). acceptId drives the LevelFlight client accept/sign link.

const oid = (v) => (v && typeof v === 'object' ? v.$oid : v) || null;

export function mapDispatchToQuote(d) {
  const dispatchId = oid(d?._id);
  const total = d?._internal?.price?.breakdown?.calculatedTotal
    ?? d?._internal?.price?.total
    ?? null;
  const legs = (d?.legs || []).map((l) => ({
    from: l?.departure?.airport ?? null,
    to: l?.arrival?.airport ?? null,
    depTime: l?.departure?.time ?? null,
    arrTime: l?.arrival?.time ?? null,
    distance: l?.distance ?? null,
    pax: l?.pax ?? l?.passengers ?? null,
  }));
  return {
    dispatchId,
    acceptId: d?.clientAcceptId || dispatchId,
    tail: d?.aircraft?.tailNumber ?? null,
    aircraftType: d?.aircraft?.type?.name ?? null,
    total,
    legs,
  };
}
