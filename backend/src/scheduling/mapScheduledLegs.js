// backend/src/scheduling/mapScheduledLegs.js
//
// Pure mapper: LevelFlight /api/analytics/scheduledLegs returns an array of legs,
// each carrying its parent dispatch (trip) and embedded crew. Turn that into our
// three operational entities. Field-path fallbacks mirror the proven exjet-ingest
// ETL.
//
// Returns { trips, legs, crew }, each an array of records shaped for
// reconcileBatch: { lfOid, values, snapshot, [ref] }. `values` holds only real
// columns; `ref` carries a parent's lf_oid for the orchestrator to resolve into a
// uuid FK before upserting.
import { oidToStr, toIsoTimestamp } from './lfNormalize.js';

function legOidOf(l) {
  return oidToStr(l?._id?.$oid) || oidToStr(l?._id) || oidToStr(l?.oid) || oidToStr(l?.id);
}
function dispatchOidOf(l) {
  return (
    oidToStr(l?.dispatch?._id?.$oid) || oidToStr(l?.dispatch?._id) ||
    oidToStr(l?.dispatch?.oid) || oidToStr(l?.dispatch?.id) ||
    oidToStr(l?.dispatchOid) || oidToStr(l?.dispatch_id) || null
  );
}
function aircraftOidOf(l) {
  return (
    oidToStr(l?.dispatch?.aircraft?._id?.$oid) || oidToStr(l?.dispatch?.aircraft?._id) ||
    oidToStr(l?.dispatch?.aircraft?.oid) || oidToStr(l?.dispatch?.aircraft?.id) ||
    oidToStr(l?.aircraft?._id?.$oid) || oidToStr(l?.aircraft?._id) || null
  );
}
function depIcaoOf(l) {
  return l?.departure?.airport || l?.departureAirport || l?.from || l?.dep ||
    l?.dep_icao || l?.depIcao || l?._calc?.from?.icao || l?._calc?.from?.airport || null;
}
function arrIcaoOf(l) {
  return l?.arrival?.airport || l?.arrivalAirport || l?.to || l?.arr ||
    l?.arr_icao || l?.arrIcao || l?._calc?.to?.icao || l?._calc?.to?.airport || null;
}
function depTimeOf(l) {
  return toIsoTimestamp(l?.dep_time) || toIsoTimestamp(l?.etd) || toIsoTimestamp(l?.scheduledETD) ||
    toIsoTimestamp(l?.departureTime) || toIsoTimestamp(l?.departure?.time) || toIsoTimestamp(l?.block?.out) || null;
}
function arrTimeOf(l) {
  return toIsoTimestamp(l?.arr_time) || toIsoTimestamp(l?.eta) || toIsoTimestamp(l?.scheduledETA) ||
    toIsoTimestamp(l?.arrivalTime) || toIsoTimestamp(l?.arrival?.time) || toIsoTimestamp(l?.block?.in) || null;
}

export function mapScheduledLegs(rawLegs) {
  const tripsByOid = new Map();
  const legRecords = [];
  const crewRecords = [];

  for (const l of rawLegs || []) {
    const legOid = legOidOf(l);
    const dispatchOid = dispatchOidOf(l);
    if (!legOid || !dispatchOid) continue; // can't place a leg without its trip

    // Trip — deduped; first leg seen wins for trip-level fields.
    if (!tripsByOid.has(dispatchOid)) {
      const d = l.dispatch || {};
      tripsByOid.set(dispatchOid, {
        lfOid: dispatchOid,
        values: {
          status: d.status ?? l.status ?? null,
          trip_number: d.tripId != null ? String(d.tripId) : null,
          aircraft_lf_oid: aircraftOidOf(l),
          company_lf_oid: oidToStr(d?.client?.company?._id?.$oid) || oidToStr(d?.client?.company?._id) || null,
          customer_lf_oid: oidToStr(d?.client?.customer?._id?.$oid) || oidToStr(d?.client?.customer?._id) || null,
        },
        snapshot: d,
      });
    }

    // Leg — note: no status column in our schema (status lives on the trip).
    legRecords.push({
      lfOid: legOid,
      values: {
        dep_icao: depIcaoOf(l),
        arr_icao: arrIcaoOf(l),
        dep_time: depTimeOf(l),
        arr_time: arrTimeOf(l),
      },
      snapshot: l,
      ref: { tripLfOid: dispatchOid },
    });

    // Crew — first PIC (seat 2) and first SIC (seat 3) per leg.
    const pilots = (Array.isArray(l?.pilots) && l.pilots) || (Array.isArray(l?.crew?.pilots) && l.crew.pilots) || [];
    const seenSeat = new Set();
    for (const p of pilots) {
      const u = p?.user || p?.pilot || p?.crew || p;
      const crewOid = oidToStr(u?._id?.$oid) || oidToStr(u?._id) || oidToStr(u?.oid) || oidToStr(u?.id);
      const seatNum = p?.seat ?? p?.position ?? null;
      const seat = seatNum === 2 ? 'PIC' : seatNum === 3 ? 'SIC' : null;
      if (!crewOid || !seat || seenSeat.has(seat)) continue;
      seenSeat.add(seat);
      crewRecords.push({
        lfOid: `${legOid}:${seat}`,
        values: { crew_lf_oid: crewOid, seat },
        snapshot: { crew_lf_oid: crewOid, seat },
        ref: { legLfOid: legOid },
      });
    }
  }

  // Per-trip leg sequence, ordered by departure time.
  const byTrip = new Map();
  for (const leg of legRecords) {
    const t = leg.ref.tripLfOid;
    if (!byTrip.has(t)) byTrip.set(t, []);
    byTrip.get(t).push(leg);
  }
  for (const group of byTrip.values()) {
    group.sort((a, b) => String(a.values.dep_time ?? '').localeCompare(String(b.values.dep_time ?? '')));
    group.forEach((leg, i) => { leg.values.seq = i; });
  }

  return { trips: Array.from(tripsByOid.values()), legs: legRecords, crew: crewRecords };
}
