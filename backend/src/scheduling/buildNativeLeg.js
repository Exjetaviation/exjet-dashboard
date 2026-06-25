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

const eft = (mins) => { const m = Math.round(mins || 0); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };

// leg:  { dep_icao, arr_icao, dep_time, arr_time, seq, dep_fbo, arr_fbo }
// trip: { id, trip_number, status, aircraft_tail, customer_name }
// time: { distanceNm, minutes } from the flight-time engine (optional) — populates
//       `_calc` so native legs show distance + flight time in the same list/detail
//       components as mirrored legs (FlightsList reads `_calc.time`/`distance.value`).
export function buildNativeLegSnapshot(leg = {}, trip = {}, time = null) {
  const status = trip.status ?? 'quote';
  const hasRoute = !!(leg.dep_icao && leg.arr_icao);
  const mins = time && time.minutes != null ? Math.round(time.minutes) : null;
  return {
    _id: { $oid: `${trip.id}:${leg.seq ?? 0}` },
    departure: { airport: leg.dep_icao || null, time: toMs(leg.dep_time), fbo: leg.dep_fbo || null },
    arrival: { airport: leg.arr_icao || null, time: toMs(leg.arr_time), fbo: leg.arr_fbo || null },
    _calc: hasRoute && time ? {
      distance: { value: time.distanceNm != null ? Math.round(time.distanceNm) : null },
      minutes: mins,
      _minutes: mins,
      time: mins != null ? eft(mins) : null,
    } : null,
    dispatch: {
      _id: { $oid: trip.id ?? null },
      tripId: trip.trip_number ?? null,
      status,
      aircraft: { tailNumber: trip.aircraft_tail ?? null, type: { name: null } },
      client: { company: { name: trip.customer_name ?? null } },
    },
    pilots: [],
    attendants: [],
    passengerCount: leg.pax || 0,
    isPositioning: !!leg.positioning,
    status,
  };
}
