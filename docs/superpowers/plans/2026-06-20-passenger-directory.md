# Passenger Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote passengers from per-trip rows to a persistent directory of first-class people whose identity and travel documents are reused across every trip.

**Architecture:** New `scheduling_people` table holds the person (identity + travel credentials). `scheduling_passengers` becomes a thin per-trip join (`person_id` + per-trip overrides). `scheduling_documents` gains `person_id` so passports/green cards hang off the person. A migration + two one-time scripts backfill existing data and re-home document files. New `/api/scheduling/people` endpoints back a Passengers directory page, a person profile page, and a reworked trip manifest picker.

**Tech Stack:** Node/Express backend (`backend/src/scheduling/`, `backend/src/routes/scheduling.js`), Supabase (Postgres + Storage), React/Vite frontend (`frontend/src/pages/scheduling/`), `node:test` for unit tests.

**Spec:** `docs/superpowers/specs/2026-06-20-passenger-directory-design.md`

**Test command:** `node --test backend/src/scheduling/*.test.js` (run from repo root; Node 25 needs the glob).

**Prerequisite (confirmed live 2026-06-20):** migrations 012/013 + the private `scheduling-docs` Storage bucket exist in Supabase.

---

## Phase A — Pure backend logic (TDD)

### Task 1: Name helpers

**Files:**
- Create: `backend/src/scheduling/peopleName.js`
- Test: `backend/src/scheduling/peopleName.test.js`

- [ ] **Step 1: Write the failing test**

```js
// backend/src/scheduling/peopleName.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayName, identityKey, splitLegacyName } from './peopleName.js';

test('displayName joins present name parts', () => {
  assert.equal(displayName({ first_name: 'John', middle_name: 'A', last_name: 'Smith' }), 'John A Smith');
  assert.equal(displayName({ first_name: 'John', last_name: 'Smith' }), 'John Smith');
  assert.equal(displayName({ first_name: 'Cher' }), 'Cher');
  assert.equal(displayName({}), '');
});

test('identityKey lowercases name and appends dob when present', () => {
  assert.equal(identityKey('John Smith', '1971-03-02'), 'john smith|1971-03-02');
  assert.equal(identityKey('  John Smith ', null), 'john smith');
});

test('splitLegacyName splits first / middle / last', () => {
  assert.deepEqual(splitLegacyName('John Smith'), { first_name: 'John', middle_name: '', last_name: 'Smith' });
  assert.deepEqual(splitLegacyName('John A Smith'), { first_name: 'John', middle_name: 'A', last_name: 'Smith' });
  assert.deepEqual(splitLegacyName('John Adam B Smith'), { first_name: 'John', middle_name: 'Adam B', last_name: 'Smith' });
  assert.deepEqual(splitLegacyName('Cher'), { first_name: 'Cher', middle_name: '', last_name: '' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/scheduling/peopleName.test.js`
Expected: FAIL — `Cannot find module './peopleName.js'`

- [ ] **Step 3: Write the implementation**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/scheduling/peopleName.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/scheduling/peopleName.js backend/src/scheduling/peopleName.test.js
git commit -m "feat(scheduling): pure name helpers for passenger directory"
```

---

### Task 2: Document expiry alerts

**Files:**
- Create: `backend/src/scheduling/docExpiry.js`
- Test: `backend/src/scheduling/docExpiry.test.js`

- [ ] **Step 1: Write the failing test**

```js
// backend/src/scheduling/docExpiry.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documentAlerts } from './docExpiry.js';

const NOW = Date.parse('2026-06-20');
const day = (s) => Date.parse(s);

test('expired passport is red even with no trips', () => {
  const a = documentAlerts({ passport_expiry: '2025-01-01' }, [], NOW);
  assert.equal(a.length, 1);
  assert.equal(a[0].key, 'passport');
  assert.equal(a[0].severity, 'red');
  assert.equal(a[0].reason, 'expired');
});

test('passport expiring before the next booked trip is red', () => {
  const a = documentAlerts({ passport_expiry: '2026-07-01' }, [day('2026-08-01')], NOW);
  assert.equal(a[0].severity, 'red');
  assert.equal(a[0].reason, 'expires-before-trip');
});

test('passport valid but inside the 6-month window is amber', () => {
  // trip 2026-07-01, passport expires 2026-10-01 -> within 6 months after the trip
  const a = documentAlerts({ passport_expiry: '2026-10-01' }, [day('2026-07-01')], NOW);
  assert.equal(a[0].severity, 'amber');
  assert.equal(a[0].reason, 'six-month-rule');
});

test('passport valid well past the window produces no alert', () => {
  assert.deepEqual(documentAlerts({ passport_expiry: '2030-01-01' }, [day('2026-07-01')], NOW), []);
});

test('null / missing expiry dates are ignored', () => {
  assert.deepEqual(documentAlerts({ passport_expiry: null, visa_expiry: '' }, [day('2026-07-01')], NOW), []);
});

test('checks passport, visa and green card independently', () => {
  const a = documentAlerts({ passport_expiry: '2025-01-01', visa_expiry: '2030-01-01' }, [], NOW);
  assert.deepEqual(a.map((x) => x.key), ['passport']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/scheduling/docExpiry.test.js`
Expected: FAIL — `Cannot find module './docExpiry.js'`

- [ ] **Step 3: Write the implementation**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/scheduling/docExpiry.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/scheduling/docExpiry.js backend/src/scheduling/docExpiry.test.js
git commit -m "feat(scheduling): pure document-expiry alert logic"
```

---

### Task 3: Backfill grouping

**Files:**
- Create: `backend/src/scheduling/peopleBackfill.js`
- Test: `backend/src/scheduling/peopleBackfill.test.js`

- [ ] **Step 1: Write the failing test**

```js
// backend/src/scheduling/peopleBackfill.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupPeople } from './peopleBackfill.js';

test('groups passenger rows into distinct people by name + dob', () => {
  const { people, passengerToKey } = groupPeople([
    { id: 'p1', name: 'John Smith', dob: '1971-03-02', weight_lbs: 185 },
    { id: 'p2', name: 'John Smith', dob: '1971-03-02', weight_lbs: 185 },  // same person, other trip
    { id: 'p3', name: 'John Smith', dob: '1989-11-20', weight_lbs: 160 },  // different DOB -> different person
  ]);
  assert.equal(people.length, 2);
  assert.equal(passengerToKey.p1, passengerToKey.p2);
  assert.notEqual(passengerToKey.p1, passengerToKey.p3);
  const john71 = people.find((x) => x.dob === '1971-03-02');
  assert.equal(john71.first_name, 'John');
  assert.equal(john71.last_name, 'Smith');
  assert.equal(john71.weight_lbs, 185);
});

test('null-DOB rows group by name only', () => {
  const { people } = groupPeople([
    { id: 'a', name: 'Jane Doe', dob: null, weight_lbs: null },
    { id: 'b', name: 'Jane Doe', dob: null, weight_lbs: 130 },
  ]);
  assert.equal(people.length, 1);
});

test('nameless rows are skipped', () => {
  const { people, passengerToKey } = groupPeople([{ id: 'x', name: '  ', dob: null }]);
  assert.equal(people.length, 0);
  assert.equal(passengerToKey.x, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/scheduling/peopleBackfill.test.js`
Expected: FAIL — `Cannot find module './peopleBackfill.js'`

- [ ] **Step 3: Write the implementation**

```js
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
    if (!people.has(key)) {
      const parts = splitLegacyName(name);
      people.set(key, { key, ...parts, dob: r.dob || null, weight_lbs: r.weight_lbs ?? null });
    }
  }
  return { people: [...people.values()], passengerToKey };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/scheduling/peopleBackfill.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/scheduling/peopleBackfill.js backend/src/scheduling/peopleBackfill.test.js
git commit -m "feat(scheduling): pure backfill grouping for passenger directory"
```

---

### Task 4: Directory search ranking

**Files:**
- Create: `backend/src/scheduling/peopleSearch.js`
- Test: `backend/src/scheduling/peopleSearch.test.js`

- [ ] **Step 1: Write the failing test**

```js
// backend/src/scheduling/peopleSearch.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankPeople } from './peopleSearch.js';

const PEOPLE = [
  { id: '1', first_name: 'John', last_name: 'Smith', dob: '1971-03-02' },
  { id: '2', first_name: 'Jane', last_name: 'Smithe', dob: '1989-11-20' },
  { id: '3', first_name: 'Aaron', last_name: 'Jones', dob: '1980-01-01' },
];

test('empty query returns everyone (capped)', () => {
  assert.equal(rankPeople(PEOPLE, '').length, 3);
  assert.equal(rankPeople(PEOPLE, '', 2).length, 2);
});

test('prefix match on a name part ranks above substring', () => {
  const r = rankPeople(PEOPLE, 'smi');
  assert.deepEqual(r.map((p) => p.id), ['1', '2']); // both match "Smith"/"Smithe", tie broken by name
});

test('matches a first name', () => {
  assert.deepEqual(rankPeople(PEOPLE, 'aaro').map((p) => p.id), ['3']);
});

test('matches DOB digits', () => {
  assert.deepEqual(rankPeople(PEOPLE, '1989').map((p) => p.id), ['2']);
});

test('no match returns empty', () => {
  assert.deepEqual(rankPeople(PEOPLE, 'zzz'), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/scheduling/peopleSearch.test.js`
Expected: FAIL — `Cannot find module './peopleSearch.js'`

- [ ] **Step 3: Write the implementation**

```js
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
  scored.sort((a, b) => b.score - a.score || (a.p.last_name || '').localeCompare(b.p.last_name || '') || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map((s) => s.p);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/scheduling/peopleSearch.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Run the whole suite + commit**

```bash
node --test backend/src/scheduling/*.test.js
git add backend/src/scheduling/peopleSearch.js backend/src/scheduling/peopleSearch.test.js
git commit -m "feat(scheduling): pure directory-search ranking"
```
Expected: full suite PASS (no regressions).

---

## Phase B — Schema + data migration

### Task 5: Migration 014 (schema only)

**Files:**
- Create: `backend/migrations/014_scheduling_people.sql`

- [ ] **Step 1: Write the migration**

```sql
-- backend/migrations/014_scheduling_people.sql
-- Persistent passenger directory. Passengers become first-class people whose
-- identity + travel documents are reused across trips. scheduling_passengers
-- becomes a thin per-trip join; scheduling_documents can attach to a person.

create table if not exists public.scheduling_people (
  id                    uuid primary key default gen_random_uuid(),
  first_name            text,
  middle_name           text,
  last_name             text,
  dob                   date,
  gender                text,
  nationality           text,
  citizenship           text,
  weight_lbs            numeric,
  email                 text,
  phone                 text,
  passport_number       text,
  passport_country      text,
  passport_expiry       date,
  green_card_number     text,
  green_card_expiry     date,
  visa_number           text,
  visa_expiry           date,
  known_traveler_number text,
  redress_number        text,
  notes                 text,
  origin                text not null default 'native' check (origin in ('levelflight', 'native')),
  lf_oid                text unique,
  modified_by           text,
  modified_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists scheduling_people_name_idx on public.scheduling_people (last_name, first_name);

-- Passengers: thin per-trip join + per-trip overrides.
alter table public.scheduling_passengers
  add column if not exists person_id uuid references public.scheduling_people(id) on delete restrict,
  add column if not exists seat text;
create index if not exists scheduling_passengers_person_idx on public.scheduling_passengers (person_id);

-- Documents: can belong to a person (reused across trips). A person document has
-- no trip, so trip_id must be nullable now.
alter table public.scheduling_documents
  add column if not exists person_id uuid references public.scheduling_people(id) on delete cascade;
alter table public.scheduling_documents
  alter column trip_id drop not null;
create index if not exists scheduling_documents_person_idx on public.scheduling_documents (person_id);
```

- [ ] **Step 2: Commit**

```bash
git add backend/migrations/014_scheduling_people.sql
git commit -m "feat(scheduling): migration 014 — scheduling_people + per-trip join"
```

- [ ] **Step 3: USER APPLIES the migration**

The user runs `014_scheduling_people.sql` in the Supabase SQL editor (same flow as 008–013). Do not proceed to Task 6 until confirmed applied — the backfill script writes to these new columns.

---

### Task 6: Backfill script (data)

**Files:**
- Create: `backend/scripts/backfillPeople.mjs`

- [ ] **Step 1: Write the script**

```js
// backend/scripts/backfillPeople.mjs
//
// One-time: create a scheduling_people row per distinct existing passenger and
// link scheduling_passengers.person_id + scheduling_documents.person_id.
// Idempotent: skips passengers that already have a person_id. Run from backend/:
//   node scripts/backfillPeople.mjs
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { groupPeople } from '../src/scheduling/peopleBackfill.js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// 1. Load passengers that aren't linked yet.
const { data: pax, error: pe } = await sb
  .from('scheduling_passengers').select('id, name, dob, weight_lbs').is('person_id', null);
if (pe) throw pe;
console.log(`Unlinked passengers: ${pax.length}`);

const { people, passengerToKey } = groupPeople(pax);
console.log(`Distinct people to create: ${people.length}`);

// 2. Insert people, remembering key -> new id.
const keyToId = {};
for (const p of people) {
  const { data, error } = await sb.from('scheduling_people')
    .insert({ first_name: p.first_name, middle_name: p.middle_name || null, last_name: p.last_name || null,
              dob: p.dob, weight_lbs: p.weight_lbs, origin: 'native' })
    .select('id').single();
  if (error) throw error;
  keyToId[p.key] = data.id;
}

// 3. Link each passenger row to its person.
for (const [passengerId, key] of Object.entries(passengerToKey)) {
  const personId = keyToId[key];
  if (!personId) continue;
  const { error } = await sb.from('scheduling_passengers').update({ person_id: personId }).eq('id', passengerId);
  if (error) throw error;
}

// 4. Re-point passenger-attached documents to the person.
const { data: docs, error: de } = await sb
  .from('scheduling_documents').select('id, passenger_id').not('passenger_id', 'is', null).is('person_id', null);
if (de) throw de;
for (const d of docs) {
  const key = passengerToKey[d.passenger_id];
  const personId = key && keyToId[key];
  if (!personId) continue;
  const { error } = await sb.from('scheduling_documents').update({ person_id: personId }).eq('id', d.id);
  if (error) throw error;
}
console.log(`Linked ${Object.keys(passengerToKey).length} passengers, re-pointed ${docs.length} documents. Done.`);
```

- [ ] **Step 2: Commit**

```bash
git add backend/scripts/backfillPeople.mjs
git commit -m "feat(scheduling): one-time people backfill script"
```

- [ ] **Step 3: USER RUNS the backfill (after Task 5 applied)**

From `backend/`: `node scripts/backfillPeople.mjs`. Expected output: counts of passengers found, people created, documents re-pointed. Re-runnable (it only touches rows with `person_id IS NULL`).

---

### Task 7: Document re-home script (storage files)

**Files:**
- Create: `backend/scripts/rehomePassengerDocs.mjs`

- [ ] **Step 1: Write the script**

```js
// backend/scripts/rehomePassengerDocs.mjs
//
// One-time: move person-attached document files from the old trip-scoped path
// ({trip_id}/...) to the person-scoped path (people/{person_id}/...) and update
// storage_path. Idempotent: skips files already under people/. Run after
// backfillPeople.mjs, from backend/:  node scripts/rehomePassengerDocs.mjs
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'scheduling-docs';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const { data: docs, error } = await sb
  .from('scheduling_documents').select('id, person_id, storage_path').not('person_id', 'is', null);
if (error) throw error;

let moved = 0;
for (const d of docs) {
  if (!d.storage_path || d.storage_path.startsWith('people/')) continue; // already re-homed
  const base = d.storage_path.split('/').pop();
  const dest = `people/${d.person_id}/${base}`;
  const { error: me } = await sb.storage.from(BUCKET).move(d.storage_path, dest);
  if (me) { console.warn(`move failed for ${d.id}: ${me.message}`); continue; }
  const { error: ue } = await sb.from('scheduling_documents').update({ storage_path: dest }).eq('id', d.id);
  if (ue) throw ue;
  moved++;
}
console.log(`Re-homed ${moved} document file(s). Done.`);
```

- [ ] **Step 2: Commit**

```bash
git add backend/scripts/rehomePassengerDocs.mjs
git commit -m "feat(scheduling): one-time document re-home script"
```

- [ ] **Step 3: USER RUNS it (after Task 6)**

From `backend/`: `node scripts/rehomePassengerDocs.mjs`. Expected: count of files moved. Re-runnable.

---

## Phase C — Backend API

> All routes go in `backend/src/routes/scheduling.js`. Add these imports near the top (next to the other `../scheduling/*` imports):
> ```js
> import { documentAlerts } from '../scheduling/docExpiry.js';
> import { rankPeople } from '../scheduling/peopleSearch.js';
> ```
> And update the existing `DOC_COLS` constant (currently at ~line 540) to include `person_id`:
> ```js
> const DOC_COLS = 'id, name, doc_type, storage_path, content_type, size_bytes, created_at, passenger_id, person_id';
> ```
> Add this shared constant near `PAX_COLS` (~line 444):
> ```js
> const PERSON_COLS = 'id, first_name, middle_name, last_name, dob, gender, nationality, citizenship, weight_lbs, email, phone, passport_number, passport_country, passport_expiry, green_card_number, green_card_expiry, visa_number, visa_expiry, known_traveler_number, redress_number, notes, origin, lf_oid, created_at, updated_at';
> ```

### Task 8: `GET /people` (directory search)

**Files:**
- Modify: `backend/src/routes/scheduling.js` (add route + constants/imports above)

- [ ] **Step 1: Add the imports, `PERSON_COLS`, and update `DOC_COLS`** as described in the Phase C preamble.

- [ ] **Step 2: Add the route** (place it just before the `GET /trips/:lfOid/passengers` route):

```js
// GET /api/scheduling/people?q=&limit= — passenger directory search. Returns
// summaries with trip count + expiry alerts for the directory list.
router.get('/people', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const { data: all, error } = await supabase.from('scheduling_people').select(PERSON_COLS);
    if (error) throw error;
    const ranked = rankPeople(all || [], req.query.q, limit);
    const ids = ranked.map((p) => p.id);

    // Trip counts + each person's upcoming trip dates (for expiry alerts).
    const counts = {};
    const datesById = {};
    if (ids.length) {
      const { data: paxRows } = await supabase
        .from('scheduling_passengers').select('person_id, trip_id').in('person_id', ids);
      const tripIds = [...new Set((paxRows || []).map((r) => r.trip_id))];
      const { data: legRows } = tripIds.length
        ? await supabase.from('scheduling_legs').select('trip_id, seq, lf_synced_snapshot').in('trip_id', tripIds).order('seq')
        : { data: [] };
      const startByTrip = {};
      for (const l of legRows || []) if (startByTrip[l.trip_id] == null) startByTrip[l.trip_id] = l.lf_synced_snapshot?.departure?.time ?? null;
      const tripsByPerson = {};
      for (const r of paxRows || []) (tripsByPerson[r.person_id] ||= new Set()).add(r.trip_id);
      for (const id of ids) {
        const tset = tripsByPerson[id] || new Set();
        counts[id] = tset.size;
        datesById[id] = [...tset].map((t) => startByTrip[t]).filter((v) => v != null);
      }
    }

    res.json({ people: ranked.map((p) => ({
      id: p.id, first_name: p.first_name, middle_name: p.middle_name, last_name: p.last_name, dob: p.dob,
      hasPassport: !!p.passport_number, tripCount: counts[p.id] || 0, alerts: documentAlerts(p, datesById[p.id] || []),
    })) });
  } catch (e) {
    console.error('GET people:', e.message);
    res.status(502).json({ error: e.message, people: [] });
  }
});
```

- [ ] **Step 3: Smoke test**

Start the backend (`cd backend && npm run dev`), then:
Run: `curl -s "http://localhost:3000/api/scheduling/people?q=" | head -c 400`
Expected: JSON `{"people":[...]}` listing the backfilled people (or `{"people":[]}` if none). (Adjust port if the backend uses another.)

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/scheduling.js
git commit -m "feat(scheduling): GET /people directory search"
```

---

### Task 9: `GET /people/:id` (profile)

**Files:**
- Modify: `backend/src/routes/scheduling.js`

- [ ] **Step 1: Add the route** (just after `GET /people`):

```js
// GET /api/scheduling/people/:id — full profile: person, their documents (signed
// URLs), trip history, and expiry alerts.
router.get('/people/:id', async (req, res) => {
  try {
    const { data: person, error } = await supabase
      .from('scheduling_people').select(PERSON_COLS).eq('id', req.params.id).single();
    if (error) { if (isNotFound(error)) return res.status(404).json({ error: 'Person not found' }); throw error; }

    // Trips this person is on (via the per-trip manifest join).
    const { data: paxRows } = await supabase
      .from('scheduling_passengers').select('trip_id').eq('person_id', person.id);
    const tripIds = [...new Set((paxRows || []).map((r) => r.trip_id))];
    const trips = [];
    const tripDates = [];
    if (tripIds.length) {
      const { data: tripRows } = await supabase
        .from('scheduling_trips').select('id, lf_oid, trip_number, status').in('id', tripIds);
      const { data: legRows } = await supabase
        .from('scheduling_legs').select('trip_id, seq, lf_synced_snapshot').in('trip_id', tripIds).order('seq');
      const byTrip = new Map();
      for (const l of legRows || []) { const a = byTrip.get(l.trip_id) || []; a.push(l.lf_synced_snapshot); byTrip.set(l.trip_id, a); }
      for (const t of tripRows || []) {
        const s = quoteSummary((byTrip.get(t.id) || []).filter(Boolean));
        if (s.start != null) tripDates.push(s.start);
        trips.push({ id: t.id, ref: t.lf_oid || t.id, trip_number: t.trip_number, status: t.status, route: s.route, start: s.start });
      }
      trips.sort((a, b) => (b.start || 0) - (a.start || 0));
    }

    // Person documents with short-lived signed URLs.
    const { data: docRows } = await supabase
      .from('scheduling_documents').select(DOC_COLS).eq('person_id', person.id).order('created_at', { ascending: false });
    const documents = [];
    for (const d of docRows || []) {
      const { data: signed } = await supabase.storage.from(DOC_BUCKET).createSignedUrl(d.storage_path, 3600);
      documents.push({ ...d, url: signed?.signedUrl || null });
    }

    res.json({ person, trips, documents, alerts: documentAlerts(person, tripDates) });
  } catch (e) {
    console.error('GET person:', e.message);
    res.status(500).json({ error: 'Failed to load person' });
  }
});
```

- [ ] **Step 2: Smoke test** — grab an id from the `GET /people` output, then:
Run: `curl -s "http://localhost:3000/api/scheduling/people/<id>" | head -c 400`
Expected: JSON with `person`, `trips`, `documents`, `alerts`.

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/scheduling.js
git commit -m "feat(scheduling): GET /people/:id profile (docs, trips, alerts)"
```

---

### Task 10: Person CRUD (`POST` / `PATCH` / `DELETE`)

**Files:**
- Modify: `backend/src/routes/scheduling.js`

- [ ] **Step 1: Add the writable-fields helper + three routes** (after `GET /people/:id`):

```js
// Person fields a client may write.
const PERSON_WRITABLE = ['first_name', 'middle_name', 'last_name', 'dob', 'gender', 'nationality',
  'citizenship', 'weight_lbs', 'email', 'phone', 'passport_number', 'passport_country', 'passport_expiry',
  'green_card_number', 'green_card_expiry', 'visa_number', 'visa_expiry', 'known_traveler_number',
  'redress_number', 'notes'];

function personFields(body) {
  const out = {};
  for (const k of PERSON_WRITABLE) {
    if (!(k in body)) continue;
    let v = body[k];
    if (typeof v === 'string') v = v.trim();
    if (v === '') v = null;
    if (k === 'weight_lbs') v = v == null ? null : Number(v);
    out[k] = v;
  }
  return out;
}

// POST /api/scheduling/people — create a person.
router.post('/people', requireSchedulingEditor, async (req, res) => {
  try {
    const fields = personFields(req.body || {});
    if (!fields.first_name && !fields.last_name) return res.status(400).json({ error: 'A name is required' });
    const { data, error } = await supabase.from('scheduling_people')
      .insert({ ...fields, origin: 'native', modified_by: req.user?.email || null, modified_at: new Date().toISOString() })
      .select(PERSON_COLS).single();
    if (error) throw error;
    res.status(201).json({ person: data });
  } catch (e) { console.error('POST person:', e.message); res.status(500).json({ error: 'Failed to create person' }); }
});

// PATCH /api/scheduling/people/:id — update a person.
router.patch('/people/:id', requireSchedulingEditor, async (req, res) => {
  try {
    const fields = personFields(req.body || {});
    const { data, error } = await supabase.from('scheduling_people')
      .update({ ...fields, modified_by: req.user?.email || null, modified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', req.params.id).select(PERSON_COLS).single();
    if (error) { if (isNotFound(error)) return res.status(404).json({ error: 'Person not found' }); throw error; }
    res.json({ person: data });
  } catch (e) { console.error('PATCH person:', e.message); res.status(500).json({ error: 'Failed to update person' }); }
});

// DELETE /api/scheduling/people/:id — remove a person (only if on no trips).
router.delete('/people/:id', requireSchedulingEditor, async (req, res) => {
  try {
    const { count } = await supabase.from('scheduling_passengers')
      .select('id', { count: 'exact', head: true }).eq('person_id', req.params.id);
    if (count && count > 0) return res.status(409).json({ error: `Can't delete — this person is on ${count} trip${count === 1 ? '' : 's'}. Remove them from those trips first.` });
    // Clean up their document files, then the person (docs cascade via FK).
    const { data: docRows } = await supabase.from('scheduling_documents').select('storage_path').eq('person_id', req.params.id);
    const paths = (docRows || []).map((d) => d.storage_path).filter(Boolean);
    if (paths.length) await supabase.storage.from(DOC_BUCKET).remove(paths);
    const { error } = await supabase.from('scheduling_people').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { console.error('DELETE person:', e.message); res.status(500).json({ error: 'Failed to delete person' }); }
});
```

- [ ] **Step 2: Smoke test** (requires an editor session token; if not handy, verify via the UI in Task 14). Confirm `POST` returns 201 with a `person`, `DELETE` on a person who's on a trip returns 409.

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/scheduling.js
git commit -m "feat(scheduling): person create/update/delete (409 when on a trip)"
```

---

### Task 11: `POST /people/:id/documents`

**Files:**
- Modify: `backend/src/routes/scheduling.js`

- [ ] **Step 1: Add the route** (after the trip `POST .../documents` route, reusing `DOC_BUCKET`, `safeName`, `DOC_COLS`):

```js
// POST /api/scheduling/people/:id/documents — upload a person document
// (passport/green card/visa/id). Stored under people/{id}/… and reused on every
// trip. Body: { name, doc_type, content_type, data_base64 }.
router.post('/people/:id/documents', requireSchedulingEditor, express.json({ limit: '25mb' }), async (req, res) => {
  try {
    const { data: person, error } = await supabase.from('scheduling_people').select('id').eq('id', req.params.id).single();
    if (error) { if (isNotFound(error)) return res.status(404).json({ error: 'Person not found' }); throw error; }
    const b = req.body || {};
    const name = safeName(b.name);
    const base64 = (b.data_base64 || '').replace(/^data:[^;]+;base64,/, '');
    if (!base64) return res.status(400).json({ error: 'No file data' });
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length) return res.status(400).json({ error: 'Empty file' });
    const storage_path = `people/${person.id}/${Date.now()}-${name}`;
    const { error: ue } = await supabase.storage.from(DOC_BUCKET)
      .upload(storage_path, buffer, { contentType: b.content_type || 'application/octet-stream', upsert: false });
    if (ue) { if (/bucket/i.test(ue.message)) return res.status(500).json({ error: `Storage bucket "${DOC_BUCKET}" is missing — create it (private) in Supabase.` }); throw ue; }
    const { data: row, error: ie } = await supabase.from('scheduling_documents').insert({
      person_id: person.id, name, doc_type: (b.doc_type || 'passport').trim() || 'passport',
      storage_path, content_type: b.content_type || null, size_bytes: buffer.length, uploaded_by: req.user?.email || null,
    }).select(DOC_COLS).single();
    if (ie) throw ie;
    res.status(201).json({ document: row });
  } catch (e) { console.error('POST person doc:', e.message); res.status(500).json({ error: 'Failed to upload document' }); }
});
```

(The existing `DELETE /documents/:id` already removes the storage file + row and needs no change.)

- [ ] **Step 2: Commit**

```bash
git add backend/src/routes/scheduling.js
git commit -m "feat(scheduling): person document upload (people/{id}/ storage)"
```

---

### Task 12: Manifest rework (join person; accept person_id + per-trip fields)

**Files:**
- Modify: `backend/src/routes/scheduling.js` (the `GET`/`PUT /trips/:lfOid/passengers` routes, ~lines 443–494)

- [ ] **Step 1: Replace `PAX_COLS` and the `GET` handler** with a person-joined version:

```js
// Per-trip passenger row + the joined person. Identity comes from the person;
// only seat/bags/TSA/note are per-trip.
const PAX_SELECT = 'id, person_id, seat, cargo_lbs, tsa_status, note, ' +
  'person:scheduling_people(id, first_name, middle_name, last_name, dob, weight_lbs, passport_number, passport_expiry, visa_expiry, green_card_expiry)';

function shapePax(row) {
  const p = row.person || {};
  return {
    id: row.id, person_id: row.person_id,
    first_name: p.first_name, middle_name: p.middle_name, last_name: p.last_name,
    name: [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' '),
    dob: p.dob ?? null, weight_lbs: p.weight_lbs ?? null,
    seat: row.seat ?? null, cargo_lbs: row.cargo_lbs ?? null, tsa_status: row.tsa_status ?? null, note: row.note ?? null,
    hasPassport: !!p.passport_number,
  };
}

// GET /api/scheduling/trips/:lfOid/passengers — manifest with joined person.
router.get('/trips/:lfOid/passengers', async (req, res) => {
  try {
    const { data: trip, error } = await supabase
      .from('scheduling_trips').select('id').eq(tripColumn(req.params.lfOid), req.params.lfOid).single();
    if (error) { if (isNotFound(error)) return res.status(404).json({ error: 'Trip not found' }); throw error; }
    const { data, error: pe } = await supabase
      .from('scheduling_passengers').select(PAX_SELECT).eq('trip_id', trip.id);
    if (pe) throw pe;
    const passengers = (data || []).map(shapePax).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    res.json({ passengers });
  } catch (e) {
    console.error('GET passengers:', e.message);
    res.status(500).json({ error: 'Failed to load passengers' });
  }
});
```

- [ ] **Step 2: Replace the `PUT` handler** to key off `person_id` + per-trip fields:

```js
// PUT /api/scheduling/trips/:lfOid/passengers — replace the manifest. Each row
// references a person (person_id) and carries only per-trip fields.
router.put('/trips/:lfOid/passengers', requireSchedulingEditor, async (req, res) => {
  try {
    const { data: trip, error } = await supabase
      .from('scheduling_trips').select('id').eq(tripColumn(req.params.lfOid), req.params.lfOid).single();
    if (error) { if (isNotFound(error)) return res.status(404).json({ error: 'Trip not found' }); throw error; }
    const list = (Array.isArray(req.body?.passengers) ? req.body.passengers : []).filter((p) => p.person_id);
    const fields = (p) => ({
      person_id: p.person_id,
      seat: (p.seat || '').trim() || null,
      cargo_lbs: p.cargo_lbs === '' || p.cargo_lbs == null ? null : Number(p.cargo_lbs),
      tsa_status: (p.tsa_status || '').trim() || null,
      note: (p.note || '').trim() || null,
    });
    // Delete rows the client dropped (keep ids it kept — preserves any attachments).
    const keepIds = list.map((p) => p.id).filter(Boolean);
    let delQ = supabase.from('scheduling_passengers').delete().eq('trip_id', trip.id);
    if (keepIds.length) delQ = delQ.not('id', 'in', `(${keepIds.join(',')})`);
    const { error: de } = await delQ; if (de) throw de;
    for (const p of list.filter((x) => x.id)) {
      const { error: ue } = await supabase.from('scheduling_passengers').update(fields(p)).eq('id', p.id).eq('trip_id', trip.id);
      if (ue) throw ue;
    }
    const inserts = list.filter((x) => !x.id).map((p) => ({ trip_id: trip.id, origin: 'native', ...fields(p) }));
    if (inserts.length) { const { error: ie } = await supabase.from('scheduling_passengers').insert(inserts); if (ie) throw ie; }
    const { data, error: se } = await supabase.from('scheduling_passengers').select(PAX_SELECT).eq('trip_id', trip.id);
    if (se) throw se;
    res.json({ passengers: (data || []).map(shapePax).sort((a, b) => (a.name || '').localeCompare(b.name || '')) });
  } catch (e) {
    console.error('PUT passengers:', e.message);
    res.status(500).json({ error: 'Failed to save passengers' });
  }
});
```

(The old `GET /passengers/suggest` route stays as-is for now — the new UI uses `/people` instead, and we remove the `/suggest` call from the frontend in Task 15.)

- [ ] **Step 3: Smoke test** — `curl` the manifest GET for a trip that has backfilled passengers; confirm each row now has `first_name/last_name/dob` from the joined person and `person_id` set.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/scheduling.js
git commit -m "feat(scheduling): manifest joins person; per-trip fields only"
```

---

## Phase D — Frontend

### Task 13: Passengers directory page + sub-nav tab

**Files:**
- Create: `frontend/src/pages/scheduling/People.jsx`
- Modify: `frontend/src/pages/Scheduling.jsx` (import + tab + render)

- [ ] **Step 1: Create the directory page**

```jsx
// frontend/src/pages/scheduling/People.jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../hooks/useApi';

const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px' };
const fullName = (p) => [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ') || 'Unnamed';
const initials = (p) => [p.first_name, p.last_name].filter(Boolean).map((s) => s[0]).join('').toUpperCase() || '?';

// Worst alert severity -> badge. red beats amber.
function AlertBadge({ alerts }) {
  if (!alerts?.length) return null;
  const red = alerts.find((a) => a.severity === 'red');
  const a = red || alerts[0];
  const color = a.severity === 'red' ? '#ef4444' : '#f59e0b';
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20, color, border: `1px solid ${color}55`, background: `${color}18` }}>
      {a.label} {a.reason === 'expired' ? 'expired' : 'expiring'}
    </span>
  );
}

export default function SchedulingPeople() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const { data, loading, error } = useApi(`/api/scheduling/people?q=${encodeURIComponent(q)}`);
  const people = data?.people || [];

  return (
    <div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search passengers by name or DOB…"
        style={{ width: '100%', maxWidth: 360, padding: '8px 12px', marginBottom: 14, fontSize: 13, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', boxSizing: 'border-box' }}
      />
      {error && <div style={{ ...card, color: 'var(--danger)' }}>Error loading passengers: {error}</div>}
      {loading ? (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Loading passengers…</p>
      ) : !people.length ? (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{q ? 'No matches.' : 'No passengers yet — they appear here once added to a trip.'}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {people.map((p) => (
            <div key={p.id} onClick={() => navigate(`/scheduling/people/${p.id}`)}
              style={{ ...card, display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
              <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(79,142,247,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{initials(p)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{fullName(p)}</span>
                  {p.hasPassport && <span title="Passport on file" style={{ fontSize: 12 }}>🛂</span>}
                  <AlertBadge alerts={p.alerts} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {p.dob ? `DOB ${p.dob}` : 'No DOB'} · {p.tripCount} trip{p.tripCount === 1 ? '' : 's'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the Scheduling sub-nav.** In `frontend/src/pages/Scheduling.jsx`:

Add the import beside the other scheduling page imports (after line 13):
```jsx
import SchedulingPeople from './scheduling/People';
```
Add a tab after the `clients` tab (after line 52):
```jsx
        <SectionTab id="people" label="Passengers" />
```
Add the render branch (after line 63):
```jsx
      {section === 'people' && <SchedulingPeople />}
```

- [ ] **Step 3: Build check**

Run: `cd frontend && npm run build`
Expected: build succeeds. Open the app → Scheduling → **Passengers** tab shows the backfilled people; typing filters; clicking a row navigates (the route is added in Task 14 — until then it 404s, which is fine).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/scheduling/People.jsx frontend/src/pages/Scheduling.jsx
git commit -m "feat(scheduling): Passengers directory page + sub-nav tab"
```

---

### Task 14: Person profile page + route

**Files:**
- Create: `frontend/src/pages/scheduling/PersonProfile.jsx`
- Modify: `frontend/src/App.jsx` (import + route inside `SchedulingApp`)

- [ ] **Step 1: Create the profile page**

```jsx
// frontend/src/pages/scheduling/PersonProfile.jsx
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../../lib/api';

const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 };
const label = { fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' };
const inp = { padding: '7px 10px', fontSize: 13, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', width: '100%', boxSizing: 'border-box' };
const fullName = (p) => [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ') || 'Unnamed';
const mask = (v) => (v ? `${'•'.repeat(Math.max(0, String(v).length - 3))}${String(v).slice(-3)}` : '—');

const IDENTITY = [
  ['first_name', 'First name'], ['middle_name', 'Middle name'], ['last_name', 'Last name'],
  ['dob', 'Date of birth', 'date'], ['gender', 'Gender'], ['nationality', 'Nationality'],
  ['citizenship', 'Citizenship'], ['weight_lbs', 'Weight (lb)', 'number'], ['email', 'Email'], ['phone', 'Phone'],
];
const CREDENTIALS = [
  ['passport_number', 'Passport #', 'text', true], ['passport_country', 'Passport country'], ['passport_expiry', 'Passport expiry', 'date'],
  ['green_card_number', 'Green card #', 'text', true], ['green_card_expiry', 'Green card expiry', 'date'],
  ['visa_number', 'Visa #', 'text', true], ['visa_expiry', 'Visa expiry', 'date'],
  ['known_traveler_number', 'Known Traveler #', 'text', true], ['redress_number', 'TSA redress #', 'text', true],
];

export default function PersonProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [edit, setEdit] = useState(null);   // draft when editing
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState({});

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/scheduling/people/${id}`);
      const j = await r.json();
      if (j.person) setData(j); else setError(j.error || 'Failed to load');
    } catch (e) { setError(e.message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const r = await apiFetch(`/api/scheduling/people/${id}`, { method: 'PATCH', body: JSON.stringify(edit) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Save failed (${r.status})`);
      setEdit(null); await load();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const uploadDoc = async (file) => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const data_base64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
      const r = await apiFetch(`/api/scheduling/people/${id}/documents`, { method: 'POST',
        body: JSON.stringify({ name: file.name, doc_type: 'passport', content_type: file.type, data_base64 }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `Upload failed (${r.status})`); }
      await load();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const delDoc = async (docId) => {
    setBusy(true);
    try { await apiFetch(`/api/scheduling/documents/${docId}`, { method: 'DELETE' }); await load(); }
    catch (e) { setError(e.message); }
    setBusy(false);
  };

  if (error && !data) return <div style={{ ...card, color: 'var(--danger)' }}>{error}</div>;
  if (!data) return <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Loading…</p>;
  const { person, trips, documents, alerts } = data;
  const v = edit || person;

  const Field = ([key, lbl, type, secret]) => (
    <div key={key} style={{ marginBottom: 8 }}>
      <div style={label}>{lbl}</div>
      {edit ? (
        <input type={type === 'date' ? 'date' : type === 'number' ? 'number' : 'text'} value={v[key] ?? ''}
          onChange={(e) => setEdit({ ...v, [key]: e.target.value })} style={inp} />
      ) : (
        <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>
          {secret && person[key] ? (
            <span onClick={() => setReveal((s) => ({ ...s, [key]: !s[key] }))} style={{ cursor: 'pointer' }} title="click to reveal">
              {reveal[key] ? person[key] : mask(person[key])}
            </span>
          ) : (person[key] ?? '—')}
        </div>
      )}
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20, flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/scheduling?section=people')} style={{ ...inp, width: 'auto', cursor: 'pointer' }}>← Passengers</button>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-primary)' }}>{fullName(person)}</h1>
        <div style={{ flex: 1 }} />
        {edit ? (
          <>
            <button onClick={save} disabled={busy} style={{ ...inp, width: 'auto', cursor: 'pointer', background: 'var(--accent)', color: '#fff', border: 'none' }}>{busy ? 'Saving…' : 'Save'}</button>
            <button onClick={() => setEdit(null)} style={{ ...inp, width: 'auto', cursor: 'pointer' }}>Cancel</button>
          </>
        ) : (
          <button onClick={() => setEdit({ ...person })} style={{ ...inp, width: 'auto', cursor: 'pointer' }}>✎ Edit</button>
        )}
      </div>

      {error && <div style={{ ...card, color: 'var(--danger)', marginBottom: 12 }}>{error}</div>}
      {alerts?.length > 0 && (
        <div style={{ ...card, marginBottom: 12, borderColor: '#f59e0b55', background: '#f59e0b14' }}>
          {alerts.map((a, i) => <div key={i} style={{ fontSize: 13, color: a.severity === 'red' ? '#ef4444' : '#f59e0b' }}>⚠️ {a.label} {a.reason.replace(/-/g, ' ')}</div>)}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        <div style={card}><div style={{ ...label, marginBottom: 10, color: 'var(--accent)' }}>Identity</div>{IDENTITY.map(Field)}</div>
        <div style={card}><div style={{ ...label, marginBottom: 10, color: '#a855f7' }}>Travel credentials</div>{CREDENTIALS.map(Field)}</div>

        <div style={card}>
          <div style={{ ...label, marginBottom: 10, color: '#a855f7' }}>Documents</div>
          {documents?.length ? documents.map((d) => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 6 }}>
              <a href={d.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none', flex: 1 }}>📄 {d.name}</a>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{d.doc_type}</span>
              <button onClick={() => delDoc(d.id)} style={{ ...inp, width: 'auto', padding: '2px 8px', cursor: 'pointer' }}>✕</button>
            </div>
          )) : <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No documents yet.</p>}
          <label style={{ ...inp, width: 'auto', display: 'inline-block', marginTop: 8, cursor: 'pointer', color: 'var(--accent)' }}>
            ↑ Upload document
            <input type="file" style={{ display: 'none' }} onChange={(e) => uploadDoc(e.target.files?.[0])} />
          </label>
        </div>

        <div style={card}>
          <div style={{ ...label, marginBottom: 10 }}>Trip history</div>
          {trips?.length ? trips.map((t) => (
            <div key={t.id} onClick={() => navigate(`/scheduling/trips/${t.ref}`)} style={{ fontSize: 13, padding: '6px 0', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}>
              <span style={{ color: 'var(--text-primary)' }}>{t.route || '—'}</span>
              <span style={{ color: 'var(--text-secondary)', marginLeft: 8 }}>{t.start ? new Date(t.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}{t.trip_number ? ` · #${t.trip_number}` : ''}</span>
            </div>
          )) : <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No trips yet.</p>}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the route.** In `frontend/src/App.jsx`, add the import near the other scheduling imports (after line 28):
```jsx
import PersonProfile from './pages/scheduling/PersonProfile';
```
Add the route inside `SchedulingApp`'s `<Routes>` (after line 99, the `trips/:id` route):
```jsx
          <Route path="people/:id" element={<PersonProfile />} />
```

- [ ] **Step 3: Build check + manual verify**

Run: `cd frontend && npm run build`
Expected: build succeeds. In the app: Scheduling → Passengers → click a person → profile loads with Identity / Travel credentials / Documents / Trip history. Edit a field → Save persists. Upload a file → appears under Documents. (Editing requires an editor role per Task 10's gate.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/scheduling/PersonProfile.jsx frontend/src/App.jsx
git commit -m "feat(scheduling): person profile page (identity, docs, trips, edit)"
```

---

### Task 15: Manifest picker rework in the trip page

**Files:**
- Modify: `frontend/src/pages/SchedulingTripDetail.jsx` (passenger state, loaders, and the Passengers `<Section>` ~lines 62–93, 204–545)

- [ ] **Step 1: Replace the passenger suggest source with a people search.** Remove these now-obsolete pieces: the `/passengers/suggest` `useApi` call and `paxSuggestions` (~line 205–206), the `onPaxName` and `blankPax` helpers (~lines 207, 213–216), the `addPax` helper (~line 210), and the `<datalist id="pax-suggest">` + the `list="pax-suggest"`/`onPaxName` name input inside the manifest (~lines 502, 505). Keep `updatePax`, `removePax`, `savePax`, `setPaxEdit`, `busy`, and `setError` — Task 15 reuses them. Add people-search state near the other passenger state (~line 62):

```jsx
  const [peopleQuery, setPeopleQuery] = useState('');
  const [peopleResults, setPeopleResults] = useState([]);
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      try {
        const r = await apiFetch(`/api/scheduling/people?q=${encodeURIComponent(peopleQuery)}`);
        const j = await r.json();
        if (live) setPeopleResults(j.people || []);
      } catch { /* ignore */ }
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [peopleQuery]);
```

- [ ] **Step 2: Change the manifest draft shape + handlers.** The draft rows now carry `person_id` + per-trip fields (not name/dob/weight, which come from the person). Replace `startPaxEdit` (~line 208) and add picker helpers:

```jsx
  // REPLACES the existing startPaxEdit (~line 208). Draft rows carry person_id +
  // per-trip fields; identity (name/dob/weight) is carried for display only.
  const startPaxEdit = () => setPaxEdit(passengers.map((p) => ({
    id: p.id, person_id: p.person_id, name: p.name, dob: p.dob, weight_lbs: p.weight_lbs,
    seat: p.seat || '', cargo_lbs: p.cargo_lbs ?? '', tsa_status: p.tsa_status || '', note: p.note || '',
  })));

  const addPerson = (person) => {
    setPaxEdit((d) => {
      if ((d || []).some((r) => r.person_id === person.id)) return d; // already on the trip
      return [...(d || []), {
        person_id: person.id, name: [person.first_name, person.middle_name, person.last_name].filter(Boolean).join(' '),
        dob: person.dob, weight_lbs: person.weight_lbs, seat: '', cargo_lbs: '', tsa_status: '', note: '',
      }];
    });
    setPeopleQuery('');
  };

  const addNewPerson = async () => {
    const first = window.prompt('First name?'); if (!first) return;
    const last = window.prompt('Last name?') || '';
    try {
      const r = await apiFetch('/api/scheduling/people', { method: 'POST', body: JSON.stringify({ first_name: first, last_name: last }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Create failed');
      addPerson(j.person);
    } catch (e) { setError(e.message); }
  };
```

Reuse the **existing** `updatePax(i, field, v)` (line 209) for per-trip field edits and the **existing** `removePax(i)` (line 211) for dropping a row — do NOT redefine them. `savePax` already sends `{ passengers: paxEdit }`, which now carries `person_id` + per-trip fields — no change needed. Errors use the page's existing `setError`/`error`.

- [ ] **Step 3: Replace the Passengers `<Section>` body** (the editor branch + the read view, ~lines 490–545) with:

```jsx
      <Section title="Passengers" right={
        !paxEdit && (
          <button onClick={startPaxEdit} disabled={busy} style={{ padding: '5px 12px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>✎ Edit manifest</button>
        )
      }>
        {paxEdit ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* picker */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input value={peopleQuery} onChange={(e) => setPeopleQuery(e.target.value)} placeholder="Search people to add…" style={{ ...inp, flex: '1 1 220px' }} />
              <button onClick={addNewPerson} style={{ padding: '5px 12px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>+ Add new person</button>
            </div>
            {peopleQuery && peopleResults.length > 0 && (
              <div style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
                {peopleResults.map((r) => (
                  <div key={r.id} onClick={() => addPerson(r)} style={{ padding: '7px 10px', fontSize: 13, cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}>
                    <span>{[r.first_name, r.middle_name, r.last_name].filter(Boolean).join(' ')} <span style={{ color: 'var(--text-secondary)' }}>· {r.dob || 'no DOB'}{r.hasPassport ? ' · 🛂' : ''}</span></span>
                    <span style={{ color: 'var(--accent)' }}>add →</span>
                  </div>
                ))}
              </div>
            )}
            {/* manifest rows: identity read-only, per-trip editable */}
            {(paxEdit || []).map((p, i) => (
              <div key={p.person_id || i} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
                <span style={{ flex: '2 1 160px', fontSize: 13, color: 'var(--text-primary)' }}>{p.name} <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{p.dob || ''}</span></span>
                <input value={p.seat} onChange={(e) => updatePax(i, 'seat', e.target.value)} placeholder="Seat" style={{ ...inp, flex: '0 1 70px' }} />
                <input value={p.cargo_lbs} onChange={(e) => updatePax(i, 'cargo_lbs', e.target.value)} placeholder="Bags lb" type="number" style={{ ...inp, flex: '0 1 80px' }} />
                <input value={p.tsa_status} onChange={(e) => updatePax(i, 'tsa_status', e.target.value)} placeholder="TSA" style={{ ...inp, flex: '0 1 90px' }} />
                <input value={p.note} onChange={(e) => updatePax(i, 'note', e.target.value)} placeholder="Trip note" style={{ ...inp, flex: '1 1 120px' }} />
                <button onClick={() => removePax(i)} style={{ padding: '4px 8px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--danger)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>✕</button>
              </div>
            ))}
            {error && <p style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={savePax} disabled={busy} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>{busy ? 'Saving…' : 'Save manifest'}</button>
              <button onClick={() => setPaxEdit(null)} style={{ padding: '6px 14px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>Cancel</button>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Name, DOB &amp; weight come from the person — edit those on their profile. Only seat/bags/TSA/note are per-trip.</p>
          </div>
        ) : passengers.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {passengers.map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, flexWrap: 'wrap' }}>
                <a href={`/scheduling/people/${p.person_id}`} style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>{p.name}</a>
                {p.hasPassport && <span title="Passport on file">🛂</span>}
                <span style={{ color: 'var(--text-secondary)' }}>
                  {p.dob ? `DOB ${p.dob}` : ''}{p.weight_lbs ? ` · ${p.weight_lbs} lb` : ''}{p.seat ? ` · seat ${p.seat}` : ''}{p.cargo_lbs ? ` · ${p.cargo_lbs} lb bags` : ''}{p.tsa_status ? ` · ${p.tsa_status}` : ''}{p.note ? ` · ${p.note}` : ''}
                </span>
              </div>
            ))}
          </div>
        ) : <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No passengers on the manifest. Click “Edit manifest” to add some.</p>}
      </Section>
```

(Per-passenger document upload moves to the person profile, so the old `documents.filter((d) => d.passenger_id === p.id)` block inside the manifest is removed. Trip-level documents — the existing Documents `<Section>` filtering on `!d.passenger_id` — stay as-is.)

- [ ] **Step 4: Build check + manual verify**

Run: `cd frontend && npm run build`
Expected: build succeeds. In the app: open a trip → Passengers → Edit manifest → search a person → add → set seat/bags/TSA → Save. Reload and confirm it persists with identity read from the person. Each passenger name links to their profile.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/SchedulingTripDetail.jsx
git commit -m "feat(scheduling): manifest picker — add from directory, per-trip fields"
```

---

## Final verification

- [ ] Run the full backend suite: `node --test backend/src/scheduling/*.test.js` → all PASS.
- [ ] `cd frontend && npm run build` → succeeds.
- [ ] End-to-end smoke (editor role): add a person to a trip → open Passengers directory → open their profile → upload a passport with an expiry → confirm the expiry badge appears on the directory and the manifest.
- [ ] Confirm with the user before any push (review-before-push).

## Notes for the implementer

- **Do not push** to origin without the user's explicit OK (they review the diff first).
- **PII:** never `console.log` passport/green-card/KTN/redress numbers. The UI masks them; keep them out of logs and error messages.
- **Migrations/scripts are user-run** against Supabase — Tasks 5–7 have explicit USER steps. Don't assume they ran; the routes degrade to empty lists if `scheduling_people` is empty, but the backfill is what populates the directory.
- **"+ Add new person" simplification:** the spec described an inline mini-form; Task 15 uses two `window.prompt`s (first/last name) to create the record, then the dispatcher fills the rest on the profile page. This is a deliberate v1 shortcut — swapping in a proper inline form later is a self-contained follow-up that doesn't change the data flow.
- **Out of scope (v1):** merge-duplicates UI, seeding people from the LF customer directory, per-leg passenger assignment, mobile-app consumption.
```
