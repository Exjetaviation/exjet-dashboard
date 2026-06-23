import { supabase } from './supabase.js';
import { mapReleaseLeg, mapManifest } from './tripSheet.js';
import { airportName } from '../scheduling/airportNames.js';
import { airportCoord } from '../scheduling/airports.js';
import { aircraftInfo } from '../scheduling/fleet.js';
import { legMinutes } from '../scheduling/priceQuote.js';

const EXJET_OPERATOR = { name: 'EXJET AVIATION', address: '4250 Execuair Street, Suite G, Orlando, FL 32827' };
const eftStr = (mins) => { const m = Math.round(mins || 0); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };

// Pure: native passenger rows (scheduling_passengers ⋈ scheduling_people) → LF pax shape.
export const paxToLf = (rows) => (rows || []).map((p) => ({
  _id: p.person_id,
  firstName: p.first_name, lastName: p.last_name,
  gender: p.gender || null,
  weight: p.weight_lbs ?? null,
  birthday: p.dob ?? null,
  citizenship: p.citizenship || null,
  documents: p.passport_number ? [{ number: p.passport_number, country: p.passport_country }] : [],
  seat: (p.seat != null && p.seat !== '' && !Number.isNaN(Number(p.seat))) ? Number(p.seat) : null,
}));

// Pure: synthesize the LF release-leg shape for mapReleaseLeg. _calc carries only what
// native has; elevation/timezone/comms + weather(METAR) + fuel are absent → null.
// dispatch.purpose drives legFlightType: owner → 91 (id 8), else 135 (id 7).
export const toReleaseLeg = (legRow, time, legPassengers, purpose) => {
  const snap = legRow.lf_synced_snapshot || {};
  const depC = airportCoord(legRow.dep_icao), arrC = airportCoord(legRow.arr_icao);
  const hasPax = (snap.passengerCount || 0) > 0 && !snap.isPositioning;
  return {
    callSign: null,
    purpose: null,
    dispatch: { purpose: purpose === 'owner' ? 8 : 7 },
    departure: { airport: legRow.dep_icao || null, time: snap.departure?.time ?? (legRow.dep_time ? Date.parse(legRow.dep_time) : null), fbo: snap.departure?.fbo || null },
    arrival: { airport: legRow.arr_icao || null, time: snap.arrival?.time ?? (legRow.arr_time ? Date.parse(legRow.arr_time) : null), fbo: snap.arrival?.fbo || null },
    _calc: {
      from: { name: airportName(legRow.dep_icao), location: depC ? { lat: depC.lat, lng: depC.lng } : null },
      to: { name: airportName(legRow.arr_icao), location: arrC ? { lat: arrC.lat, lng: arrC.lng } : null },
      distance: { value: time?.distanceNm ?? null },
      minutes: time?.minutes ?? null,
      time: time ? eftStr(time.minutes) : null,
    },
    passengers: hasPax ? legPassengers : [],
    passengerCount: hasPax ? legPassengers.length : 0,
    pilots: snap.pilots || [],
    attendants: snap.attendants || [],
    weather: null,
    releasedBy: null,
    crewNote: null,
  };
};

// Build the crew trip-sheet VM for a NATIVE trip (uuid). Same shape as
// tripSheet.buildCrewTripSheet → renderTripSheetHtml renders identically; LF-only
// sections render blank, maintenance is skipped.
export async function buildNativeTripSheetVM(tripId) {
  const { data: trip, error } = await supabase
    .from('scheduling_trips').select('id, quote_number, trip_number, company_name, contact, purpose').eq('id', tripId).single();
  if (error || !trip) return null;
  const { data: legRows } = await supabase
    .from('scheduling_legs').select('dep_icao, arr_icao, dep_time, arr_time, lf_synced_snapshot, seq').eq('trip_id', tripId).order('seq');
  const rows = legRows || [];
  if (!rows.length) return null;
  const { data: paxRows } = await supabase
    .from('scheduling_passengers').select('seat, person_id, person:scheduling_people(first_name, last_name, dob, gender, citizenship, weight_lbs, passport_number, passport_country)').eq('trip_id', tripId);
  const lfPax = paxToLf((paxRows || []).map((p) => ({ person_id: p.person_id, seat: p.seat, ...p.person })));
  const legPassengers = lfPax.map((p) => ({ user: { _id: p._id }, seat: p.seat }));
  const tripManifest = mapManifest(lfPax);
  const paxById = new Map();
  for (const lp of lfPax) paxById.set(lp._id, mapManifest([lp])[0]);

  const tail = rows[0]?.lf_synced_snapshot?.dispatch?.aircraft?.tailNumber || null;
  const { type, maxPax } = aircraftInfo(tail);
  const times = await legMinutes(null, rows.map((l) => ({ dep_icao: l.dep_icao, arr_icao: l.arr_icao })));
  const legs = rows.map((l, i) => mapReleaseLeg(toReleaseLeg(l, times[i], legPassengers, trip.purpose), new Map(), paxById, tripManifest));

  const totalDist = legs.reduce((s, l) => s + (l.distance || 0), 0);
  const totalMin = legs.reduce((s, l) => s + (l.minutes || 0), 0);
  const route = legs.map((l) => l.from).concat(legs[legs.length - 1].to).filter(Boolean).join(', ');

  return {
    dispatchId: tripId,
    tripNumber: trip.trip_number != null ? String(trip.trip_number) : null,
    quoteNumber: trip.quote_number != null ? String(trip.quote_number) : null,
    routeSummary: route || null,
    operator: { name: EXJET_OPERATOR.name, address: EXJET_OPERATOR.address, cert: null, part: trip.purpose === 'owner' ? 91 : 135 },
    client: { name: trip.contact?.name || null, company: trip.company_name || null, address: null },
    aircraft: { tail, type, serial: null, maxPax, year: null },
    totals: { legs: legs.length, distance: totalDist || null, minutes: totalMin || null },
    tsa: null,
    legs,
    manifest: tripManifest,
    maintenance: null,
    preparedOn: new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
  };
}
