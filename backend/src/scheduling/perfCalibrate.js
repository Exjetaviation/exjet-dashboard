// backend/src/scheduling/perfCalibrate.js
//
// DB-backed calibration for the aircraft performance profile. Kept separate from
// the pure `perfProfile.js` so the pure fit stays unit-testable without pulling in
// Supabase (which instantiates at import). Mirrors the autoClose.js glue pattern.
import { supabase } from '../services/supabase.js';
import { airportCoord } from './airports.js';
import { greatCircleNm } from './distance.js';
import { fitProfile, DEFAULT_PROFILE } from './perfProfile.js';

// Recompute each type's profile from completed-leg history (pricing_history today;
// native completed legs after cutover). Uses OUR haversine distance so the recovered
// cruise speed is consistent with how we estimate. Best-effort; never throws to caller.
export async function calibratePerfProfiles() {
  const { data, error } = await supabase
    .from('pricing_history')
    .select('aircraft_type, origin, destination, flight_mins')
    .gt('flight_mins', 0);
  if (error) throw error;

  const byType = new Map();
  for (const r of data || []) {
    const nm = greatCircleNm(airportCoord(r.origin), airportCoord(r.destination));
    if (!nm || !(r.flight_mins > 0)) continue;
    if (!byType.has(r.aircraft_type)) byType.set(r.aircraft_type, []);
    byType.get(r.aircraft_type).push([nm, r.flight_mins]);
  }

  let updated = 0;
  for (const [type, pairs] of byType) {
    const fit = fitProfile(pairs);
    if (!fit || !type) continue;
    const { error: ue } = await supabase.from('scheduling_perf_profiles').upsert({
      aircraft_type: type, cruise_kt: fit.cruise_kt, buffer_min: fit.buffer_min,
      n_legs: fit.n_legs, r2: fit.r2, updated_at: new Date().toISOString(),
    });
    if (ue) throw ue;
    updated += 1;
  }
  return updated;
}

// Profile for an aircraft type, falling back to the seed.
export async function getPerfProfile(aircraftType) {
  if (aircraftType) {
    const { data } = await supabase
      .from('scheduling_perf_profiles').select('cruise_kt, buffer_min').eq('aircraft_type', aircraftType).maybeSingle();
    if (data) return { cruise_kt: Number(data.cruise_kt), buffer_min: Number(data.buffer_min) };
  }
  return DEFAULT_PROFILE;
}
