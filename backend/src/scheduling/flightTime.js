import { DEFAULT_PROFILE } from './perfProfile.js';

export function estimateLegMinutes(distanceNm, profile = DEFAULT_PROFILE) {
  if (distanceNm == null) return null;
  return profile.buffer_min + (distanceNm / profile.cruise_kt) * 60;
}

// leg: { depIcao, arrIcao, aircraftType, distanceNm }
// opts: { profile, historyAvg }  historyAvg keyed `${type}|${dep}|${arr}` AND `${dep}|${arr}`
// Prefer the actual flown time on this exact route — the most precise number there
// is, and LevelFlight's own. The route-only key is a type-agnostic fallback so native
// quotes (which carry no aircraft type) still hit history; only then do we estimate.
export function flightTimeForLeg(leg, { profile = DEFAULT_PROFILE, historyAvg = {} } = {}) {
  const hist = historyAvg[`${leg.aircraftType}|${leg.depIcao}|${leg.arrIcao}`] ?? historyAvg[`${leg.depIcao}|${leg.arrIcao}`];
  if (hist != null) return { minutes: hist, distanceNm: leg.distanceNm, source: 'history' };
  return { minutes: estimateLegMinutes(leg.distanceNm, profile), distanceNm: leg.distanceNm, source: 'estimate' };
}
