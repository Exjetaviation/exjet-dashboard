// backend/src/scheduling/peopleName.js
//
// Pure name helpers for the passenger directory. No DB access.

export function displayName(p) {
  return [p?.first_name, p?.middle_name, p?.last_name]
    .map((s) => (s || '').trim()).filter(Boolean).join(' ');
}

// Stable dedup key: lowercased full name, plus DOB when we have one (so two
// different people who share a name but not a birthday stay distinct).
export function identityKey(name, dob) {
  const n = String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
  return dob ? `${n}|${dob}` : n;
}

// Split a legacy single-string name into first / middle / last.
export function splitLegacyName(name) {
  const t = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (t.length === 0) return { first_name: '', middle_name: '', last_name: '' };
  if (t.length === 1) return { first_name: t[0], middle_name: '', last_name: '' };
  if (t.length === 2) return { first_name: t[0], middle_name: '', last_name: t[1] };
  return { first_name: t[0], middle_name: t.slice(1, -1).join(' '), last_name: t[t.length - 1] };
}
