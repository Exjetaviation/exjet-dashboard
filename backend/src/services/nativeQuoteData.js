import { supabase } from './supabase.js';
import { airportCoord } from '../scheduling/airports.js';
import { airportName } from '../scheduling/airportNames.js';
import { aircraftInfo } from '../scheduling/fleet.js';
import { legMinutes } from '../scheduling/priceQuote.js';

const eftStr = (mins) => { const m = Math.round(mins || 0); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };

// Pure: one native leg (+ its computed time) → the quote VM leg shape that
// renderQuoteHtml consumes. Coords come back as [lat, lng] like the LF VM.
export const mapNativeQuoteLeg = (leg, time) => {
  const dep = airportCoord(leg.dep_icao), arr = airportCoord(leg.arr_icao);
  return {
    from: leg.dep_icao || null,
    to: leg.arr_icao || null,
    fromName: airportName(leg.dep_icao),
    toName: airportName(leg.arr_icao),
    depTime: leg.dep_time ? Date.parse(leg.dep_time) : null,
    arrTime: leg.arr_time ? Date.parse(leg.arr_time) : null,
    distance: time?.distanceNm ?? null,
    eft: time ? eftStr(time.minutes) : null,
    pax: leg.pax ?? null,
    fromLatLng: dep ? [dep.lat, dep.lng] : null,
    toLatLng: arr ? [arr.lat, arr.lng] : null,
  };
};

const today = () => new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// Build the Quote VM for a NATIVE trip (uuid). Mirrors quoteData.buildViewModel's
// shape so renderQuoteHtml renders identically; acceptUrl/pdfUrl point at our own
// public routes.
export async function buildNativeQuoteVM(tripId) {
  const { data: trip, error } = await supabase
    .from('scheduling_trips').select('id, quote_number, pricing').eq('id', tripId).single();
  if (error || !trip) return null;
  const { data: legRows } = await supabase
    .from('scheduling_legs').select('dep_icao, arr_icao, dep_time, arr_time, lf_synced_snapshot, seq')
    .eq('trip_id', tripId).order('seq');
  const rows = legRows || [];
  const tail = rows[0]?.lf_synced_snapshot?.dispatch?.aircraft?.tailNumber || null;
  const { type, maxPax } = aircraftInfo(tail);
  const times = await legMinutes(null, rows.map((l) => ({ dep_icao: l.dep_icao, arr_icao: l.arr_icao })));
  const legs = rows.map((l, i) => mapNativeQuoteLeg(
    { ...l, pax: l.lf_synced_snapshot?.passengerCount ?? null }, times[i]));
  const total = trip.pricing && !trip.pricing.error ? (trip.pricing.total ?? null) : null;
  return {
    dispatchId: tripId,
    quoteNumber: trip.quote_number != null ? String(trip.quote_number) : null,
    tail, aircraftType: type, maxPax, total,
    amenities: ['Flight Attendant', 'WIFI'],
    preparedBy: null,
    preparedOn: today(),
    acceptUrl: `/quote/${tripId}/accept`,
    pdfUrl: `/quote/${tripId}/pdf`,
    legs,
  };
}
