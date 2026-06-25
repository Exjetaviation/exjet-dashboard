// frontend/src/lib/flightTime.js
// Pure helpers for OOOI/flight-time math. No imports.

export function minutesBetween(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const a = new Date(startIso).getTime();
  const b = new Date(endIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 60000);
}

export function minutesToHhmm(min) {
  if (min == null || Number.isNaN(min)) return '';
  const sign = min < 0 ? '-' : '';
  const m = Math.abs(Math.round(min));
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  return `${sign}${h}:${mm}`;
}

export function hoursFromMinutes(min) {
  if (min == null || Number.isNaN(min)) return null;
  return min / 60;
}
