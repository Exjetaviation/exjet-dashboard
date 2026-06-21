// backend/src/scheduling/peopleSearch.js
//
// Pure ranking for the directory search box. Prefix match on a name part beats a
// substring match beats a DOB-digit match. No DB access — the route fetches the
// people and passes them here.

import { displayName } from './peopleName.js';

export function rankPeople(people, query, limit = 50) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return (people || []).slice(0, limit);

  const scored = [];
  for (const p of people || []) {
    const name = displayName(p).toLowerCase();
    let score = 0;
    if (name.split(/\s+/).some((w) => w.startsWith(q))) score = 3;
    else if (name.includes(q)) score = 2;
    else if (String(p.dob || '').includes(q)) score = 1;
    if (score > 0) scored.push({ p, score, name });
  }
  const cmp = (a, b) =>
    b.score - a.score ||
    (a.p.last_name || '').localeCompare(b.p.last_name || '') ||
    a.name.localeCompare(b.name);
  scored.sort(cmp);
  return scored.slice(0, limit).map((s) => s.p);
}
