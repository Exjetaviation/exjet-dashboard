// frontend/src/lib/trips.js
// Pure grouping of leg objects (from /api/levelflight/legs) into trips, keyed by the
// leg's dispatch id. No React / no I/O so it can be unit-tested directly.
const oid = (v) => (v && typeof v === 'object' ? v.$oid : v) || null;

export function groupLegsIntoTrips(legs = []) {
  const byTrip = new Map();
  for (const leg of legs) {
    const id = oid(leg?.dispatch?._id) || 'ungrouped';
    if (!byTrip.has(id)) byTrip.set(id, []);
    byTrip.get(id).push(leg);
  }

  const trips = [];
  for (const [dispatchId, group] of byTrip.entries()) {
    const legsSorted = [...group].sort((a, b) => (a.departure?.time || 0) - (b.departure?.time || 0));
    const d = legsSorted[0]?.dispatch || {};
    const airports = legsSorted.length
      ? [legsSorted[0].departure?.airport, ...legsSorted.map((l) => l.arrival?.airport)].filter(Boolean)
      : [];
    const allCompleted = legsSorted.every((l) => l.status === 3);
    const firstOpen = legsSorted.find((l) => l.status !== 3);
    trips.push({
      dispatchId,
      tripId: d.tripId ?? null,
      quoteId: d.quoteId ?? null,
      tail: d.aircraft?.tailNumber ?? null,
      type: d.aircraft?.type?.name ?? null,
      client: d.client?.company?.name ?? null,
      legs: legsSorted,
      legCount: legsSorted.length,
      from: airports[0] ?? null,
      to: airports[airports.length - 1] ?? null,
      routeSummary: airports.join(' → '),
      start: Math.min(...legsSorted.map((l) => l.departure?.time || Infinity)),
      end: Math.max(...legsSorted.map((l) => l.arrival?.time || l.departure?.time || 0)),
      status: allCompleted ? 3 : (firstOpen?.status ?? 0),
    });
  }
  return trips.sort((a, b) => (b.end || 0) - (a.end || 0));
}
