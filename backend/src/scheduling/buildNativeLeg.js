// backend/src/scheduling/buildNativeLeg.js
//
// Build a LevelFlight-shaped leg snapshot for a NATIVE (created-here) leg, so it
// renders in the very same list / board / detail components the mirrored legs use
// — no schema change needed. The snapshot is stored in scheduling_legs.lf_synced_snapshot
// with origin='native'. Field paths mirror what the LF leg objects carry.
function toMs(value) {
  if (!value) return null;
  const n = Date.parse(value);
  return Number.isFinite(n) ? n : null;
}

// leg:  { dep_icao, arr_icao, dep_time, arr_time, seq }
// trip: { id, trip_number, status, aircraft_tail, customer_name }
export function buildNativeLegSnapshot(leg = {}, trip = {}) {
  const status = trip.status ?? 'quote';
  return {
    _id: { $oid: `${trip.id}:${leg.seq ?? 0}` },
    departure: { airport: leg.dep_icao || null, time: toMs(leg.dep_time) },
    arrival: { airport: leg.arr_icao || null, time: toMs(leg.arr_time) },
    dispatch: {
      _id: { $oid: trip.id ?? null },
      tripId: trip.trip_number ?? null,
      status,
      aircraft: { tailNumber: trip.aircraft_tail ?? null, type: { name: null } },
      client: { company: { name: trip.customer_name ?? null } },
    },
    pilots: [],
    attendants: [],
    passengerCount: 0,
    status,
  };
}
