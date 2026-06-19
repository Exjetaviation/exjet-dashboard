import { DEFAULT_PROFILE } from './perfProfile.js';

export function estimateLegMinutes(distanceNm, profile = DEFAULT_PROFILE) {
  if (distanceNm == null) return null;
  return profile.buffer_min + (distanceNm / profile.cruise_kt) * 60;
}

// leg: { depIcao, arrIcao, aircraftType, distanceNm }
// opts: { profile, historyAvg }  historyAvg keyed `${type}|${dep}|${arr}` -> avg minutes
export function flightTimeForLeg(leg, { profile = DEFAULT_PROFILE, historyAvg = {} } = {}) {
  const key = `${leg.aircraftType}|${leg.depIcao}|${leg.arrIcao}`;
  const hist = historyAvg[key];
  if (hist != null) return { minutes: hist, distanceNm: leg.distanceNm, source: 'history' };
  return { minutes: estimateLegMinutes(leg.distanceNm, profile), distanceNm: leg.distanceNm, source: 'estimate' };
}
