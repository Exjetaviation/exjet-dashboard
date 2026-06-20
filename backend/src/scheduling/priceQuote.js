import { supabase } from '../services/supabase.js';
import { airportCoord } from './airports.js';
import { greatCircleNm } from './distance.js';
import { flightTimeForLeg } from './flightTime.js';
import { getPerfProfile } from './perfCalibrate.js';
import { priceTrip } from './pricing.js';

const UNKNOWN_AIRPORT_MIN = 150; // fallback flight time when an airport has no coords

// Avg actual minutes per `${type}|${dep}|${arr}` from history, both directions.
async function loadHistoryAvg() {
  const { data, error } = await supabase
    .from('pricing_history').select('aircraft_type, origin, destination, flight_mins').gt('flight_mins', 0);
  if (error) return {}; // degrade to estimate-only if history is unavailable
  const sums = new Map();
  const bump = (k, v) => { const e = sums.get(k) || [0, 0]; e[0] += v; e[1] += 1; sums.set(k, e); };
  for (const r of data || []) {
    bump(`${r.aircraft_type}|${r.origin}|${r.destination}`, r.flight_mins);
    bump(`${r.aircraft_type}|${r.destination}|${r.origin}`, r.flight_mins);
    bump(`${r.origin}|${r.destination}`, r.flight_mins);   // route-only (type-agnostic) for native quotes
    bump(`${r.destination}|${r.origin}`, r.flight_mins);
  }
  const out = {};
  for (const [k, [sum, n]] of sums) out[k] = Math.round(sum / n);
  return out;
}

// legs: [{ dep_icao, arr_icao, pax, isPositioning }]; returns the priceTrip breakdown,
// or { error } when no rate card exists for the tail.
// Per-leg flight time (minutes) from the engine — history override else estimate,
// flat fallback for unknown airports. Used to derive arrival times on create.
export async function legMinutes(aircraftType, legs) {
  const [profile, historyAvg] = await Promise.all([getPerfProfile(aircraftType), loadHistoryAvg()]);
  return (legs || []).map((l) => {
    const distanceNm = greatCircleNm(airportCoord(l.dep_icao), airportCoord(l.arr_icao));
    const ft = flightTimeForLeg({ depIcao: l.dep_icao, arrIcao: l.arr_icao, aircraftType, distanceNm }, { profile, historyAvg });
    const minutes = ft.minutes != null ? ft.minutes : UNKNOWN_AIRPORT_MIN;
    return { minutes, distanceNm, source: ft.minutes != null ? ft.source : 'unknown-airport' };
  });
}

export async function priceQuoteLegs({ tail, aircraftType, legs, nights = 0 }) {
  const { data: rateCard } = await supabase
    .from('rate_cards').select('*').eq('aircraft_tail', tail).maybeSingle();
  if (!rateCard) return { error: `No rate card for ${tail || 'aircraft'}.` };

  const [profile, historyAvg] = await Promise.all([getPerfProfile(aircraftType), loadHistoryAvg()]);

  const priced = legs.map((l) => {
    const distanceNm = greatCircleNm(airportCoord(l.dep_icao), airportCoord(l.arr_icao));
    const ft = flightTimeForLeg(
      { depIcao: l.dep_icao, arrIcao: l.arr_icao, aircraftType, distanceNm },
      { profile, historyAvg });
    const minutes = ft.minutes != null ? ft.minutes : UNKNOWN_AIRPORT_MIN;
    const source = ft.minutes != null ? ft.source : 'unknown-airport';
    return { from: l.dep_icao, to: l.arr_icao, mins: minutes, pax: l.pax || 0, isPositioning: !!l.isPositioning, source };
  });

  return { ...priceTrip({ legs: priced, rateCard, nights }) };
}
