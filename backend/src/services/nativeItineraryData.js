import { supabase } from './supabase.js';
import { getDailyForecast } from './weather.js';
import { mapItineraryLeg } from './itineraryData.js';
import { airportName } from '../scheduling/airportNames.js';
import { airportCoord } from '../scheduling/airports.js';
import { aircraftInfo } from '../scheduling/fleet.js';
import { legMinutes } from '../scheduling/priceQuote.js';

const eftStr = (mins) => { const m = Math.round(mins || 0); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };

// Pure: enrich a native leg row (+ computed time + the trip manifest in LF passenger
// shape) into the LevelFlight leg shape that mapItineraryLeg consumes. Crew + FBO come
// from the stored snapshot (Crew tab / C3); _calc + passengers are synthesized.
export const toLfLeg = (legRow, time, paxLf) => {
  const snap = legRow.lf_synced_snapshot || {};
  const depC = airportCoord(legRow.dep_icao), arrC = airportCoord(legRow.arr_icao);
  const hasPax = (snap.passengerCount || 0) > 0 && !snap.isPositioning;
  return {
    departure: { airport: legRow.dep_icao || null, time: snap.departure?.time ?? (legRow.dep_time ? Date.parse(legRow.dep_time) : null), fbo: snap.departure?.fbo || null },
    arrival: { airport: legRow.arr_icao || null, time: snap.arrival?.time ?? (legRow.arr_time ? Date.parse(legRow.arr_time) : null), fbo: snap.arrival?.fbo || null },
    _calc: {
      from: { name: airportName(legRow.dep_icao), location: depC ? { lat: depC.lat, lng: depC.lng } : null },
      to: { name: airportName(legRow.arr_icao), location: arrC ? { lat: arrC.lat, lng: arrC.lng } : null },
      distance: { value: time?.distanceNm ?? null },
      time: time ? eftStr(time.minutes) : null,
    },
    passengers: hasPax ? paxLf : [],
    passengerCount: hasPax ? paxLf.length : 0,
    pilots: snap.pilots || [],
    attendants: snap.attendants || [],
  };
};

// Build the passenger-itinerary VM for a NATIVE trip (uuid). Same shape as
// itineraryData.buildItinerary, so renderItineraryHtml renders identically.
export async function buildNativeItineraryVM(tripId) {
  const { data: trip, error } = await supabase
    .from('scheduling_trips').select('id, quote_number, trip_number, company_name, contact').eq('id', tripId).single();
  if (error || !trip) return null;
  const { data: legRows } = await supabase
    .from('scheduling_legs').select('dep_icao, arr_icao, dep_time, arr_time, lf_synced_snapshot, seq').eq('trip_id', tripId).order('seq');
  const rows = legRows || [];
  const { data: paxRows } = await supabase
    .from('scheduling_passengers').select('seat, person_id, person:scheduling_people(first_name, last_name)').eq('trip_id', tripId);
  const paxLf = (paxRows || []).map((p) => ({
    seat: (p.seat != null && p.seat !== '' && !Number.isNaN(Number(p.seat))) ? Number(p.seat) : null,
    user: { _id: p.person_id, firstName: p.person?.first_name, lastName: p.person?.last_name },
  }));

  const tail = rows[0]?.lf_synced_snapshot?.dispatch?.aircraft?.tailNumber || null;
  const { type, maxPax } = aircraftInfo(tail);
  const times = await legMinutes(null, rows.map((l) => ({ dep_icao: l.dep_icao, arr_icao: l.arr_icao })));
  const allLegs = rows.map((l, i) => mapItineraryLeg(toLfLeg(l, times[i], paxLf)));
  const withPax = allLegs.filter((l) => (l.pax || 0) > 0);
  const legs = withPax.length ? withPax : allLegs;

  const airports = new Map();
  for (const l of legs) {
    if (l.from && l.fromLatLng) airports.set(l.from, { code: l.from, name: l.fromName, ll: l.fromLatLng });
    if (l.to && l.toLatLng) airports.set(l.to, { code: l.to, name: l.toName, ll: l.toLatLng });
  }
  const weather = [];
  for (const a of airports.values()) {
    const forecast = await getDailyForecast(a.ll[0], a.ll[1]);
    if (forecast.length) weather.push({ code: a.code, name: a.name, forecast });
  }

  return {
    dispatchId: tripId,
    tripNumber: trip.trip_number != null ? String(trip.trip_number) : null,
    quoteNumber: trip.quote_number != null ? String(trip.quote_number) : null,
    tail, aircraftType: type, maxPax,
    client: { name: trip.contact?.name || null, company: trip.company_name || null, address: null },
    legs, weather,
    preparedOn: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
  };
}
