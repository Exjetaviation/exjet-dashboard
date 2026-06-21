// backend/src/scheduling/docExpiry.js
//
// Pure expiry-warning logic for a person's travel credentials. No DB access.
// Severity: red  = already expired, or expires before the next booked trip.
//           amber = valid, but expires within 6 months of the next booked trip
//                   (common international entry requirement).

const DAY = 86_400_000;
const SIX_MONTHS = 183 * DAY;

const CREDENTIALS = [
  { key: 'passport', field: 'passport_expiry', label: 'Passport' },
  { key: 'visa', field: 'visa_expiry', label: 'Visa' },
  { key: 'green_card', field: 'green_card_expiry', label: 'Green card' },
];

export function documentAlerts(person, upcomingTripMs = [], now = Date.now()) {
  // upcomingTripMs values are trip DEPARTURE timestamps (ms since epoch).
  // Per IATA convention the 6-month validity rule is measured from departure date.
  const nextTrip = (upcomingTripMs || [])
    .filter((t) => t != null && t >= now)
    .sort((a, b) => a - b)[0] ?? null;

  const alerts = [];
  for (const c of CREDENTIALS) {
    const raw = person?.[c.field];
    if (!raw) continue;
    const exp = Date.parse(raw);
    if (Number.isNaN(exp)) continue;
    if (exp < now) {
      alerts.push({ key: c.key, label: c.label, severity: 'red', reason: 'expired' });
    } else if (nextTrip != null && exp < nextTrip) {
      alerts.push({ key: c.key, label: c.label, severity: 'red', reason: 'expires-before-trip' });
    } else if (nextTrip != null && exp < nextTrip + SIX_MONTHS) {
      alerts.push({ key: c.key, label: c.label, severity: 'amber', reason: 'six-month-rule' });
    }
  }
  return alerts;
}
