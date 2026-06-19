import * as ss from 'simple-statistics';

// Seed used until a type has enough history (recovered from 52 GIV-SP legs, R²=0.97).
export const DEFAULT_PROFILE = { cruise_kt: 452, buffer_min: 14 };
export const MIN_LEGS = 8;

// pairs: [[distanceNm, flightMinutes], ...] -> { cruise_kt, buffer_min, n_legs, r2 } | null
export function fitProfile(pairs) {
  if (!Array.isArray(pairs) || pairs.length < MIN_LEGS) return null;
  const lr = ss.linearRegression(pairs); // { m: min per nm, b: intercept min }
  if (!(lr.m > 0) || !Number.isFinite(lr.b)) return null;
  const r2 = ss.rSquared(pairs, ss.linearRegressionLine(lr));
  return {
    cruise_kt: Math.round((60 / lr.m) * 10) / 10,
    buffer_min: Math.round(lr.b * 10) / 10,
    n_legs: pairs.length,
    r2: Math.round(r2 * 1000) / 1000,
  };
}
