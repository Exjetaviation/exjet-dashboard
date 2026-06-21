// backend/src/scheduling/peopleBackfill.js
//
// Pure dedup for the one-time backfill (scripts/backfillPeople.mjs). Groups legacy
// per-trip passenger rows into distinct people. No DB access — the script applies
// the result.

import { identityKey, splitLegacyName } from './peopleName.js';

// rows: [{ id, name, dob, weight_lbs }]  (id = scheduling_passengers.id)
// returns { people: [{ key, first_name, middle_name, last_name, dob, weight_lbs }],
//           passengerToKey: { [passengerId]: key } }
export function groupPeople(rows) {
  const people = new Map();
  const passengerToKey = {};
  for (const r of rows || []) {
    const name = (r.name || '').trim();
    if (!name) continue;
    const key = identityKey(name, r.dob);
    passengerToKey[r.id] = key;
    // v1 intentional: when multiple passenger rows map to the same person, the
    // FIRST row's weight_lbs/dob win. Merge / most-recent handling is out of scope.
    if (!people.has(key)) {
      const parts = splitLegacyName(name);
      people.set(key, { key, ...parts, dob: r.dob || null, weight_lbs: r.weight_lbs ?? null });
    }
  }
  return { people: [...people.values()], passengerToKey };
}
