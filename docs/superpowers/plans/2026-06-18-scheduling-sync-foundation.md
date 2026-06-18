# Scheduling Sync Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Supabase schema for the new Scheduling module plus the two pure logic cores it depends on — the sync **reconcile engine** (honors local edits, never overwrites them) and the **freshness** classifier — fully unit-tested with no live credentials.

**Architecture:** This is the data foundation of Slice 1 of the scheduling-dispatcher-web sub-project (see `docs/superpowers/specs/2026-06-18-scheduling-dispatcher-web-design.md`). It adds a new self-contained `backend/src/scheduling/` module. The reconcile engine is a pure function — given an incoming LevelFlight record and the existing mirror row, it decides what to write, protecting any locally-modified working copy. Keeping it pure means it is exhaustively testable before any network/database wiring (which lands in the next plan: the LevelFlight connector + scheduler + Supabase upserts + read API).

**Tech Stack:** Node 20 (ESM), Supabase/Postgres (SQL migrations applied manually in the Supabase SQL editor), `node:test` + `node:assert/strict` for tests (co-located `*.test.js`, the repo's existing convention).

---

## File Structure

- `backend/migrations/008_scheduling.sql` — **new.** The scheduling schema: `scheduling_trips`, `scheduling_legs`, `scheduling_crew_assignments`, `scheduling_passengers`, `scheduling_sync_status`. Every operational table carries the provenance columns (`origin`, `lf_oid`, `lf_synced_snapshot`, `locally_modified`, `upstream_changed`, `synced_at`, `modified_by`, `modified_at`).
- `backend/src/scheduling/reconcile.js` — **new.** Pure: `stableStringify`, `snapshotsEqual`, `reconcileRecord`. Decides the column set to write for one incoming LevelFlight record.
- `backend/src/scheduling/reconcile.test.js` — **new.** Unit tests for the above.
- `backend/src/scheduling/reconcileBatch.js` — **new.** Pure: `reconcileBatch`, applies `reconcileRecord` across an array given a map of existing rows.
- `backend/src/scheduling/reconcileBatch.test.js` — **new.** Unit tests.
- `backend/src/scheduling/freshness.js` — **new.** Pure: `freshnessLabel`, classifies mirror freshness from the last successful sync time.
- `backend/src/scheduling/freshness.test.js` — **new.** Unit tests.

Each file has one responsibility; the two reconcile files split the single-record decision from the batch orchestration so the decision logic stays trivially testable.

---

### Task 1: Scheduling database schema

**Files:**
- Create: `backend/migrations/008_scheduling.sql`

- [ ] **Step 1: Write the migration file**

Create `backend/migrations/008_scheduling.sql` with exactly this content:

```sql
-- 008_scheduling.sql
-- Schema for the new Scheduling module (replaces LevelFlight scheduling).
-- During the transition the new system mirrors LevelFlight one-way (read only)
-- and ALSO allows native create/edit. Every operational row therefore carries
-- provenance:
--   origin              'levelflight' (mirrored) | 'native' (created here)
--   lf_oid              LevelFlight ObjectId for mirrored rows (null if native)
--   lf_synced_snapshot  frozen copy of LevelFlight's version, used by "Revert"
--   locally_modified    true once a user edits a mirrored row's working copy
--   upstream_changed    true when LevelFlight changes a row the user has edited
--   synced_at           last time the sync touched this row
-- The sync NEVER overwrites a locally_modified working copy (see reconcile.js).

-- TRIPS — one object across the lifecycle; status carries quote/hold/booked/cancelled.
create table if not exists public.scheduling_trips (
    id                 uuid primary key default gen_random_uuid(),
    lf_oid             text unique,
    status             text not null default 'quote',
    trip_number        text,
    quote_number       text,
    purpose            text,
    customer_lf_oid    text,
    company_lf_oid     text,
    aircraft_lf_oid    text,
    rate_name          text,
    pricing            jsonb,
    pax_notes          text,
    crew_notes         text,
    origin             text not null default 'native',
    lf_synced_snapshot jsonb,
    locally_modified   boolean not null default false,
    upstream_changed   boolean not null default false,
    synced_at          timestamptz,
    modified_by        text,
    modified_at        timestamptz,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);
create index if not exists scheduling_trips_status_idx on public.scheduling_trips (status);

-- LEGS — belong to a trip.
create table if not exists public.scheduling_legs (
    id                 uuid primary key default gen_random_uuid(),
    trip_id            uuid not null references public.scheduling_trips(id) on delete cascade,
    lf_oid             text unique,
    seq                integer not null default 0,
    dep_icao           text,
    arr_icao           text,
    dep_time           timestamptz,
    arr_time           timestamptz,
    dep_fbo            text,
    arr_fbo            text,
    checklist          jsonb,
    origin             text not null default 'native',
    lf_synced_snapshot jsonb,
    locally_modified   boolean not null default false,
    upstream_changed   boolean not null default false,
    synced_at          timestamptz,
    modified_by        text,
    modified_at        timestamptz,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);
create index if not exists scheduling_legs_trip_idx on public.scheduling_legs (trip_id);

-- CREW ASSIGNMENTS — per leg.
create table if not exists public.scheduling_crew_assignments (
    id                 uuid primary key default gen_random_uuid(),
    leg_id             uuid not null references public.scheduling_legs(id) on delete cascade,
    lf_oid             text unique,
    crew_lf_oid        text,
    seat               text,
    origin             text not null default 'native',
    lf_synced_snapshot jsonb,
    locally_modified   boolean not null default false,
    upstream_changed   boolean not null default false,
    synced_at          timestamptz,
    modified_by        text,
    modified_at        timestamptz,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);
create index if not exists scheduling_crew_assignments_leg_idx on public.scheduling_crew_assignments (leg_id);

-- PASSENGERS — per trip.
create table if not exists public.scheduling_passengers (
    id                 uuid primary key default gen_random_uuid(),
    trip_id            uuid not null references public.scheduling_trips(id) on delete cascade,
    lf_oid             text unique,
    name               text,
    dob                date,
    weight_lbs         numeric,
    cargo_lbs          numeric,
    tsa_status         text,
    note               text,
    origin             text not null default 'native',
    lf_synced_snapshot jsonb,
    locally_modified   boolean not null default false,
    upstream_changed   boolean not null default false,
    synced_at          timestamptz,
    modified_by        text,
    modified_at        timestamptz,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);
create index if not exists scheduling_passengers_trip_idx on public.scheduling_passengers (trip_id);

-- SYNC STATUS — one row per synced entity, drives the "Synced N min ago" UI.
create table if not exists public.scheduling_sync_status (
    entity          text primary key,
    last_run_at     timestamptz,
    last_success_at timestamptz,
    status          text,
    message         text,
    counts          jsonb
);
```

- [ ] **Step 2: Apply the migration**

This repo applies migrations by hand (there is no runner). Open the Supabase project → SQL Editor → paste the full contents of `backend/migrations/008_scheduling.sql` → Run.

- [ ] **Step 3: Verify the tables exist**

In the Supabase SQL Editor run:

```sql
select table_name from information_schema.tables
where table_schema = 'public' and table_name like 'scheduling_%'
order by table_name;
```

Expected: 5 rows — `scheduling_crew_assignments`, `scheduling_legs`, `scheduling_passengers`, `scheduling_sync_status`, `scheduling_trips`.

- [ ] **Step 4: Commit**

```bash
git add backend/migrations/008_scheduling.sql
git commit -m "feat(scheduling): add scheduling schema with provenance columns"
```

---

### Task 2: Reconcile engine (single record)

**Files:**
- Create: `backend/src/scheduling/reconcile.test.js`
- Create: `backend/src/scheduling/reconcile.js`

- [ ] **Step 1: Write the failing test**

Create `backend/src/scheduling/reconcile.test.js`:

```js
// backend/src/scheduling/reconcile.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stableStringify, snapshotsEqual, reconcileRecord } from './reconcile.js';

const NOW = '2026-06-18T19:00:00.000Z';

test('stableStringify is key-order independent', () => {
  assert.equal(stableStringify({ a: 1, b: 2 }), stableStringify({ b: 2, a: 1 }));
  assert.equal(snapshotsEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }), true);
  assert.equal(snapshotsEqual({ a: 1 }, { a: 2 }), false);
});

test('reconcileRecord inserts a brand-new mirrored record', () => {
  const incoming = {
    lfOid: 'lf1',
    values: { status: 'booked', trip_number: '25104' },
    snapshot: { status: 'booked', trip_number: '25104' },
  };
  const result = reconcileRecord(incoming, null, NOW);
  assert.equal(result.action, 'insert');
  assert.deepEqual(result.set, {
    lf_oid: 'lf1',
    status: 'booked',
    trip_number: '25104',
    origin: 'levelflight',
    lf_synced_snapshot: { status: 'booked', trip_number: '25104' },
    locally_modified: false,
    upstream_changed: false,
    synced_at: NOW,
  });
});

test('reconcileRecord mirrors the working copy when not locally modified', () => {
  const incoming = {
    lfOid: 'lf1',
    values: { status: 'booked', trip_number: '25104' },
    snapshot: { status: 'booked', trip_number: '25104' },
  };
  const existing = { locally_modified: false, lf_synced_snapshot: { status: 'quote' } };
  const result = reconcileRecord(incoming, existing, NOW);
  assert.equal(result.action, 'update');
  assert.deepEqual(result.set, {
    lf_oid: 'lf1',
    status: 'booked',
    trip_number: '25104',
    lf_synced_snapshot: { status: 'booked', trip_number: '25104' },
    upstream_changed: false,
    synced_at: NOW,
  });
});

test('reconcileRecord never overwrites a locally modified working copy', () => {
  const incoming = {
    lfOid: 'lf1',
    values: { status: 'booked' },
    snapshot: { status: 'booked' },
  };
  const existing = { locally_modified: true, lf_synced_snapshot: { status: 'quote' } };
  const result = reconcileRecord(incoming, existing, NOW);
  // No working-copy fields (no `status`) in the set — only snapshot/flags/time.
  assert.deepEqual(result.set, {
    lf_oid: 'lf1',
    lf_synced_snapshot: { status: 'booked' },
    upstream_changed: true, // snapshot changed quote -> booked
    synced_at: NOW,
  });
});

test('reconcileRecord does not flag upstream_changed when snapshot is unchanged', () => {
  const incoming = {
    lfOid: 'lf1',
    values: { status: 'booked' },
    snapshot: { status: 'quote' },
  };
  const existing = { locally_modified: true, lf_synced_snapshot: { status: 'quote' } };
  const result = reconcileRecord(incoming, existing, NOW);
  assert.equal(result.set.upstream_changed, false);
  assert.equal('status' in result.set, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test backend/src/scheduling/reconcile.test.js`
Expected: FAIL — cannot find module `./reconcile.js`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/scheduling/reconcile.js`:

```js
// backend/src/scheduling/reconcile.js
//
// Pure decision logic for the one-way LevelFlight -> mirror sync.
// Given one incoming LevelFlight record and the existing mirror row (or null),
// decide the column values to upsert, protecting any locally-modified copy.
// No I/O — the caller fetches existing rows and performs the upsert.

// Order-independent JSON string, so snapshot comparison ignores key order.
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

export function snapshotsEqual(a, b) {
  return stableStringify(a) === stableStringify(b);
}

// incoming: { lfOid: string, values: object, snapshot: object }
//   values   = working-copy columns derived from LevelFlight
//   snapshot = object frozen for "Revert to LevelFlight"
// existing: null | { locally_modified: boolean, lf_synced_snapshot: object }
// now: ISO timestamp string
// returns: { action: 'insert' | 'update', set: object }  (set is upserted by lf_oid)
export function reconcileRecord(incoming, existing, now) {
  const { lfOid, values, snapshot } = incoming;

  if (!existing) {
    return {
      action: 'insert',
      set: {
        lf_oid: lfOid,
        ...values,
        origin: 'levelflight',
        lf_synced_snapshot: snapshot,
        locally_modified: false,
        upstream_changed: false,
        synced_at: now,
      },
    };
  }

  if (!existing.locally_modified) {
    // Clean mirror: refresh working copy + snapshot.
    return {
      action: 'update',
      set: {
        lf_oid: lfOid,
        ...values,
        lf_synced_snapshot: snapshot,
        upstream_changed: false,
        synced_at: now,
      },
    };
  }

  // Locally modified: never touch the working copy. Refresh the snapshot and
  // flag if LevelFlight changed upstream so the user can review/revert.
  return {
    action: 'update',
    set: {
      lf_oid: lfOid,
      lf_synced_snapshot: snapshot,
      upstream_changed: !snapshotsEqual(existing.lf_synced_snapshot, snapshot),
      synced_at: now,
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test backend/src/scheduling/reconcile.test.js`
Expected: PASS — all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/scheduling/reconcile.js backend/src/scheduling/reconcile.test.js
git commit -m "feat(scheduling): reconcile engine protects local edits during sync"
```

---

### Task 3: Reconcile batch

**Files:**
- Create: `backend/src/scheduling/reconcileBatch.test.js`
- Create: `backend/src/scheduling/reconcileBatch.js`

- [ ] **Step 1: Write the failing test**

Create `backend/src/scheduling/reconcileBatch.test.js`:

```js
// backend/src/scheduling/reconcileBatch.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileBatch } from './reconcileBatch.js';

const NOW = '2026-06-18T19:00:00.000Z';

test('reconcileBatch reconciles each record against its existing row', () => {
  const incoming = [
    { lfOid: 'a', values: { status: 'booked' }, snapshot: { status: 'booked' } }, // new
    { lfOid: 'b', values: { status: 'booked' }, snapshot: { status: 'booked' } }, // clean update
    { lfOid: 'c', values: { status: 'booked' }, snapshot: { status: 'booked' } }, // locally modified
  ];
  const existingByOid = new Map([
    ['b', { locally_modified: false, lf_synced_snapshot: { status: 'quote' } }],
    ['c', { locally_modified: true, lf_synced_snapshot: { status: 'quote' } }],
  ]);

  const results = reconcileBatch(incoming, existingByOid, NOW);

  assert.equal(results.length, 3);
  assert.equal(results[0].action, 'insert');
  assert.equal(results[1].action, 'update');
  assert.equal(results[1].set.status, 'booked'); // working copy refreshed
  assert.equal('status' in results[2].set, false); // local edit preserved
  assert.equal(results[2].set.upstream_changed, true);
});

test('reconcileBatch returns an empty array for empty input', () => {
  assert.deepEqual(reconcileBatch([], new Map(), NOW), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test backend/src/scheduling/reconcileBatch.test.js`
Expected: FAIL — cannot find module `./reconcileBatch.js`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/scheduling/reconcileBatch.js`:

```js
// backend/src/scheduling/reconcileBatch.js
//
// Apply reconcileRecord across a page of incoming LevelFlight records.
// Pure: the caller supplies the existing rows (keyed by lf_oid) and performs
// the resulting upserts.
import { reconcileRecord } from './reconcile.js';

// incoming: Array<{ lfOid, values, snapshot }>
// existingByOid: Map<lfOid, existingRow>
// now: ISO timestamp string
// returns: Array<{ action, set }>
export function reconcileBatch(incoming, existingByOid, now) {
  return incoming.map((rec) =>
    reconcileRecord(rec, existingByOid.get(rec.lfOid) ?? null, now)
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test backend/src/scheduling/reconcileBatch.test.js`
Expected: PASS — both tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/scheduling/reconcileBatch.js backend/src/scheduling/reconcileBatch.test.js
git commit -m "feat(scheduling): batch reconcile over a page of records"
```

---

### Task 4: Freshness classifier

**Files:**
- Create: `backend/src/scheduling/freshness.test.js`
- Create: `backend/src/scheduling/freshness.js`

- [ ] **Step 1: Write the failing test**

Create `backend/src/scheduling/freshness.test.js`:

```js
// backend/src/scheduling/freshness.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshnessLabel } from './freshness.js';

const NOW = '2026-06-18T19:00:00.000Z';

test('freshnessLabel reports unknown when never synced', () => {
  assert.deepEqual(freshnessLabel(null, NOW), { state: 'unknown', text: 'Never synced' });
});

test('freshnessLabel is fresh within the stale window', () => {
  const twoMinAgo = '2026-06-18T18:58:00.000Z';
  assert.deepEqual(freshnessLabel(twoMinAgo, NOW), { state: 'fresh', text: 'Synced 2 min ago' });
});

test('freshnessLabel says "just now" under a minute', () => {
  const tenSecAgo = '2026-06-18T18:59:50.000Z';
  assert.deepEqual(freshnessLabel(tenSecAgo, NOW), { state: 'fresh', text: 'Synced just now' });
});

test('freshnessLabel is stale past the window (default 10 min)', () => {
  const twentyMinAgo = '2026-06-18T18:40:00.000Z';
  assert.deepEqual(freshnessLabel(twentyMinAgo, NOW), { state: 'stale', text: 'Synced 20 min ago' });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test backend/src/scheduling/freshness.test.js`
Expected: FAIL — cannot find module `./freshness.js`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/scheduling/freshness.js`:

```js
// backend/src/scheduling/freshness.js
//
// Pure: classify how fresh the mirror is from the last successful sync time.
// Operational cadence is "every few minutes", so default the stale threshold
// to 10 minutes. Drives the "Synced N min ago" indicator in the UI.
export function freshnessLabel(lastSuccessAt, now, staleAfterMs = 10 * 60 * 1000) {
  if (!lastSuccessAt) return { state: 'unknown', text: 'Never synced' };
  const ageMs = new Date(now).getTime() - new Date(lastSuccessAt).getTime();
  const mins = Math.floor(Math.max(ageMs, 0) / 60000);
  const text = mins < 1 ? 'Synced just now' : `Synced ${mins} min ago`;
  return { state: ageMs <= staleAfterMs ? 'fresh' : 'stale', text };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test backend/src/scheduling/freshness.test.js`
Expected: PASS — all 4 tests pass.

- [ ] **Step 5: Run the whole scheduling test suite**

Run: `node --test backend/src/scheduling/`
Expected: PASS — all tests across reconcile, reconcileBatch, and freshness pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/scheduling/freshness.js backend/src/scheduling/freshness.test.js
git commit -m "feat(scheduling): mirror freshness classifier"
```

---

## Next plan (not in scope here)

The follow-on plan wires these pure cores to the world: port the LevelFlight connector (Cognito auth, retry/backoff, chunking) from `~/exjet-ingest/ingest.ts`; write the LevelFlight→mirror field mappers for trips/legs/crew/passengers; the scheduled sync jobs (rolling −30/+90d window, every few minutes); persist `scheduling_sync_status`; and expose `GET /api/scheduling/sync-status`. The read UI (Schedule board + Trips list/detail reusing dashboard components) follows after that.
