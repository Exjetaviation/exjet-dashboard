// backend/src/scheduling/quoteSummary.js
//
// Build a one-line summary for a quote from its (LF-shaped) leg snapshots, ordered
// by seq. Used by GET /api/scheduling/quotes so the Quotes list can show route /
// tail / customer / dates without the frontend re-deriving them.
export function quoteSummary(snapshots) {
  const legs = (snapshots || []).filter(Boolean);
  if (!legs.length) return { route: null, tail: null, customer: null, start: null, end: null, legCount: 0 };
  const airports = [legs[0].departure?.airport, ...legs.map((l) => l.arrival?.airport)].filter(Boolean);
  return {
    route: airports.length ? airports.join(' → ') : null,
    tail: legs[0].dispatch?.aircraft?.tailNumber ?? null,
    customer: legs[0].dispatch?.client?.company?.name ?? null,
    start: legs[0].departure?.time ?? null,
    end: legs[legs.length - 1].arrival?.time ?? null,
    legCount: legs.length,
  };
}
