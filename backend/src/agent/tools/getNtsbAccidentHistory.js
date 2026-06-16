// Tool #12 — get_ntsb_accident_history(airport_icao)
//
// Returns a PRE-AGGREGATED NTSB accident/incident profile for an airport as
// situational awareness — never a go/no-go gate. Reads ntsb_airport_profiles
// (built by scripts/importNtsb.js); the agent never sees raw rows, so the
// response stays well under ~500 tokens. Cite ntsb_number for a specific event.

import { getServiceClient } from '../serviceClient.js';

// NTSB/profile airport codes are FAA identifiers (mostly 3-letter for US).
// Strip the leading K for US ICAO codes and try both forms. KFLL → ['KFLL','FLL'];
// non-K (e.g. 'MMUN') stays as-is.
export function airportQueryForms(icao) {
  const id = String(icao || '').trim().toUpperCase();
  if (!id) return [];
  const forms = new Set([id]);
  if (id.length === 4 && id.startsWith('K')) forms.add(id.slice(1));
  return [...forms];
}

export async function tool_get_ntsb_accident_history({ airport_icao } = {}) {
  const id = String(airport_icao || '').trim().toUpperCase();
  if (!id) throw new Error('airport_icao is required');
  const forms = airportQueryForms(id);

  const client = getServiceClient('get_ntsb_accident_history');
  const { data, error } = await client
    .from('ntsb_airport_profiles')
    .select('airport_code, airport_name, state, total_events, fatal_events, part135_relevant_events, top_phases, top_weather_conditions, top_damage_patterns, recent_events, pattern_warnings, last_event_date, data_through')
    .in('airport_code', forms)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`ntsb profile lookup failed: ${error.message}`);

  if (!data) {
    return {
      found: false,
      airport: id,
      note: 'No NTSB accident/incident record at this airport in the imported dataset (US airplane events, ~2008–present).',
      source: 'Supabase ntsb_airport_profiles (NTSB Aviation Accident Database, pre-aggregated; situational awareness only)',
    };
  }

  return {
    found: true,
    airport: id,
    ...data,
    source: 'Supabase ntsb_airport_profiles (NTSB Aviation Accident Database, pre-aggregated; situational awareness only)',
  };
}
