# Scheduling Sync Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the orchestration core that turns a LevelFlight `scheduledLegs` fetch into mirror upserts — resolving parent→child foreign keys, protecting local edits via the reconcile engine, and computing the fetch window — all dependency-injected so it's fully unit-tested with fakes (no live LevelFlight or Supabase).

**Architecture:** Slice 1 of the scheduling-dispatcher-web sub-project (spec: `docs/superpowers/specs/2026-06-18-scheduling-dispatcher-web-design.md`). Builds on the already-merged `backend/src/scheduling/` module (reconcile, freshness, lfNormalize, mapScheduledLegs). The orchestrator takes injected `lf` and `db` adapters, so all logic — fetch loop, mapping, FK resolution, reconcile, upsert ordering, sync-status recording — is testable against in-memory fakes. The real adapters (`syncDb`/`syncLf`), the `setInterval` worker, the `GET /api/scheduling/sync-status` route, and the `index.js` wiring are the **next plan** (the I/O shell, verified by a manual smoke test). This plan also applies the sticky-`upstream_changed` refinement noted in the foundation plan.

**Tech Stack:** Node 20 (ESM), `node:test` + `node:assert/strict`, co-located `*.test.js`. Run from the repo root: `node --test backend/src/scheduling/*.test.js` (Node 25 needs the glob).

---

## File Structure

- `backend/src/scheduling/reconcile.js` — **modify.** Make `upstream_changed` sticky.
- `backend/src/scheduling/reconcile.test.js` — **modify.** Add a stickiness test.
- `backend/src/scheduling/attachFk.js` — **new.** Pure: inject a resolved uuid FK into mapped child records, dropping orphans.
- `backend/src/scheduling/attachFk.test.js` — **new.**
- `backend/src/scheduling/runScheduledLegsSync.js` — **new.** The orchestrator (injected `lf`/`db` adapters).
- `backend/src/scheduling/runScheduledLegsSync.test.js` — **new.** Tests with in-memory fakes.
- `backend/src/scheduling/syncWindow.js` — **new.** Pure: compute month-bucket start timestamps for the −30/+90-day window.
- `backend/src/scheduling/syncWindow.test.js` — **new.**

---

### Task 1: Make `upstream_changed` sticky

**Files:**
- Modify: `backend/src/scheduling/reconcile.js`
- Modify: `backend/src/scheduling/reconcile.test.js`

- [ ] **Step 1: Add the failing test.** In `backend/src/scheduling/reconcile.test.js`, append this test at the end of the file (after the last existing test):

```js
test('reconcileRecord keeps upstream_changed sticky once set', () => {
  const incoming = { lfOid: 'lf1', values: { status: 'booked' }, snapshot: { status: 'quote' } };
  const existing = { locally_modified: true, upstream_changed: true, lf_synced_snapshot: { status: 'quote' } };
  const result = reconcileRecord(incoming, existing, NOW);
  // snapshot is unchanged, but the flag was already set — it must stay true.
  assert.equal(result.set.upstream_changed, true);
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `node --test backend/src/scheduling/reconcile.test.js`
Expected: FAIL on the new test — `upstream_changed` comes back `false` (current code recomputes purely from the snapshot diff).

- [ ] **Step 3: Make the change.** In `backend/src/scheduling/reconcile.js`, in the final (locally-modified) branch, replace this exact line:

```js
      upstream_changed: !snapshotsEqual(existing.lf_synced_snapshot, snapshot),
```

with:

```js
      // Sticky: once flagged, stays flagged until the user reverts/dismisses.
      upstream_changed: (existing.upstream_changed ?? false) || !snapshotsEqual(existing.lf_synced_snapshot, snapshot),
```

- [ ] **Step 4: Run to verify it passes.** Run: `node --test backend/src/scheduling/reconcile.test.js`
Expected: PASS — all reconcile tests pass, including the new stickiness test and the existing "does not flag upstream_changed when snapshot is unchanged" test (its `existing` has no `upstream_changed`, so `(undefined ?? false) || false === false`).

- [ ] **Step 5: Commit.**

```bash
git add backend/src/scheduling/reconcile.js backend/src/scheduling/reconcile.test.js
git commit -m "feat(scheduling): make upstream_changed sticky until reverted"
```

---

### Task 2: `attachFk` — resolve parent uuid into child records

**Files:**
- Create: `backend/src/scheduling/attachFk.test.js`
- Create: `backend/src/scheduling/attachFk.js`

- [ ] **Step 1: Write the failing test.** Create `backend/src/scheduling/attachFk.test.js`:

```js
// backend/src/scheduling/attachFk.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachFk } from './attachFk.js';

test('attachFk injects the resolved parent id into values', () => {
  const records = [
    { lfOid: 'legA', values: { dep_icao: 'KFXE' }, ref: { tripLfOid: 'disp1' } },
    { lfOid: 'legB', values: { dep_icao: 'TJSJ' }, ref: { tripLfOid: 'disp1' } },
  ];
  const idByLfOid = new Map([['disp1', 'trip-uuid-1']]);
  const out = attachFk(records, 'trip_id', (r) => r.ref.tripLfOid, idByLfOid);
  assert.equal(out.length, 2);
  assert.equal(out[0].values.trip_id, 'trip-uuid-1');
  assert.equal(out[0].values.dep_icao, 'KFXE'); // original values preserved
  assert.equal(out[0].lfOid, 'legA');
});

test('attachFk drops records whose parent id is unknown', () => {
  const records = [
    { lfOid: 'legA', values: {}, ref: { tripLfOid: 'disp1' } },
    { lfOid: 'legOrphan', values: {}, ref: { tripLfOid: 'missing' } },
  ];
  const idByLfOid = new Map([['disp1', 'trip-uuid-1']]);
  const out = attachFk(records, 'trip_id', (r) => r.ref.tripLfOid, idByLfOid);
  assert.equal(out.length, 1);
  assert.equal(out[0].lfOid, 'legA');
});

test('attachFk does not mutate the input records', () => {
  const records = [{ lfOid: 'legA', values: { dep_icao: 'KFXE' }, ref: { tripLfOid: 'disp1' } }];
  attachFk(records, 'trip_id', (r) => r.ref.tripLfOid, new Map([['disp1', 'u1']]));
  assert.equal('trip_id' in records[0].values, false);
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `node --test backend/src/scheduling/attachFk.test.js` — Expected: FAIL, cannot find module `./attachFk.js`.

- [ ] **Step 3: Write the implementation.** Create `backend/src/scheduling/attachFk.js`:

```js
// backend/src/scheduling/attachFk.js
//
// Pure: inject a resolved uuid foreign key into each mapped child record's
// `values`, after its parent has been upserted. Records whose parent id is
// unknown (parent wasn't upserted) are dropped — they'd violate the FK.
// Does not mutate the input.

// records: Array<{ lfOid, values, snapshot, ref }>
// fkColumn: the column to set (e.g. 'trip_id')
// refOf: (record) => parentLfOid
// idByLfOid: Map<parentLfOid, uuid>
// returns: a new array of records with values[fkColumn] set
export function attachFk(records, fkColumn, refOf, idByLfOid) {
  const out = [];
  for (const rec of records) {
    const id = idByLfOid.get(refOf(rec));
    if (!id) continue;
    out.push({ ...rec, values: { ...rec.values, [fkColumn]: id } });
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes.** Run: `node --test backend/src/scheduling/attachFk.test.js` — Expected: PASS, all 3 tests pass.

- [ ] **Step 5: Commit.**

```bash
git add backend/src/scheduling/attachFk.js backend/src/scheduling/attachFk.test.js
git commit -m "feat(scheduling): attachFk resolves parent uuid into child records"
```

---

### Task 3: `runScheduledLegsSync` orchestrator

**Files:**
- Create: `backend/src/scheduling/runScheduledLegsSync.test.js`
- Create: `backend/src/scheduling/runScheduledLegsSync.js`

The orchestrator depends on two injected adapters (real versions are the next plan):
- `lf.scheduledLegs(startMs)` → `Promise<rawLegs[]>`
- `db.existingByLfOid(table, lfOids)` → `Promise<Map<lfOid, { locally_modified, lf_synced_snapshot, upstream_changed }>>`
- `db.upsert(table, setRows)` → `Promise<Array<{ id, lf_oid }>>`
- `db.recordSyncStatus(entity, { status, message, counts, now })` → `Promise<void>`

- [ ] **Step 1: Write the failing test.** Create `backend/src/scheduling/runScheduledLegsSync.test.js`:

```js
// backend/src/scheduling/runScheduledLegsSync.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScheduledLegsSync } from './runScheduledLegsSync.js';

const NOW = '2026-06-18T19:00:00.000Z';

const dispatch = {
  _id: { $oid: 'disp1' }, tripId: 25104, status: 'booked',
  aircraft: { _id: { $oid: 'acN69' } },
  client: { company: { _id: { $oid: 'co1' } }, customer: { _id: { $oid: 'cust1' } } },
};
const pilots = [{ seat: 2, user: { _id: { $oid: 'pilotPIC' } } }, { seat: 3, user: { _id: { $oid: 'pilotSIC' } } }];
const legBack = { _id: { $oid: 'legA' }, status: 'booked', dispatch, pilots,
  departure: { airport: 'KFXE', time: 1765207800000 }, arrival: { airport: 'TJSJ', time: 1765222200000 } };
const legOut = { _id: { $oid: 'legB' }, status: 'booked', dispatch, pilots,
  departure: { airport: 'TJSJ', time: 1765290600000 }, arrival: { airport: 'KFXE', time: 1765305000000 } };

function makeFakeDb(seed = {}) {
  const store = {
    scheduling_trips: new Map(), scheduling_legs: new Map(), scheduling_crew_assignments: new Map(),
  };
  for (const [table, rows] of Object.entries(seed)) for (const r of rows) store[table].set(r.lf_oid, r);
  const statusCalls = [];
  let idSeq = 0;
  return {
    store, statusCalls,
    async existingByLfOid(table, oids) {
      const m = new Map();
      for (const oid of oids) {
        const r = store[table].get(oid);
        if (r) m.set(oid, {
          locally_modified: r.locally_modified ?? false,
          lf_synced_snapshot: r.lf_synced_snapshot ?? null,
          upstream_changed: r.upstream_changed ?? false,
        });
      }
      return m;
    },
    async upsert(table, rows) {
      const out = [];
      for (const set of rows) {
        const prev = store[table].get(set.lf_oid);
        const id = prev?.id ?? `${table}#${++idSeq}`;
        store[table].set(set.lf_oid, { ...(prev || {}), ...set, id });
        out.push({ id, lf_oid: set.lf_oid });
      }
      return out;
    },
    async recordSyncStatus(entity, info) { statusCalls.push({ entity, ...info }); },
  };
}

test('runScheduledLegsSync mirrors trips, legs, and crew with resolved FKs', async () => {
  const lf = { async scheduledLegs(start) { return start === 1000 ? [legOut, legBack] : []; } };
  const db = makeFakeDb();

  const counts = await runScheduledLegsSync({ lf, db, now: NOW, monthStarts: [1000, 2000] });

  // 1 trip, 2 legs, and a PIC + SIC on each leg = 4 crew assignments.
  assert.deepEqual(counts, { trips: 1, legs: 2, crew: 4 });
  assert.equal(db.store.scheduling_trips.size, 1);
  assert.equal(db.store.scheduling_legs.size, 2);
  assert.equal(db.store.scheduling_crew_assignments.size, 4);

  // legs got a real trip_id FK
  const legA = db.store.scheduling_legs.get('legA');
  assert.equal(legA.trip_id, db.store.scheduling_trips.get('disp1').id);
  // crew got a real leg_id FK
  const pic = db.store.scheduling_crew_assignments.get('legA:PIC');
  assert.equal(pic.leg_id, legA.id);
  assert.equal(pic.seat, 'PIC');

  // status recorded ok
  assert.equal(db.statusCalls.length, 1);
  assert.equal(db.statusCalls[0].entity, 'scheduledLegs');
  assert.equal(db.statusCalls[0].status, 'ok');
  assert.deepEqual(db.statusCalls[0].counts, { trips: 1, legs: 2, crew: 4 });
});

test('runScheduledLegsSync does not overwrite a locally modified trip', async () => {
  const lf = { async scheduledLegs() { return [legBack]; } };
  const db = makeFakeDb({
    scheduling_trips: [{
      lf_oid: 'disp1', id: 'trip-existing', status: 'quote',
      locally_modified: true, lf_synced_snapshot: { status: 'quote' }, upstream_changed: false,
    }],
  });

  await runScheduledLegsSync({ lf, db, now: NOW, monthStarts: [1000] });

  const trip = db.store.scheduling_trips.get('disp1');
  assert.equal(trip.status, 'quote');           // working copy preserved (not 'booked')
  assert.equal(trip.upstream_changed, true);     // LF changed quote->booked, flagged
});

test('runScheduledLegsSync records an error status and rethrows on fetch failure', async () => {
  const lf = { async scheduledLegs() { throw new Error('LF down'); } };
  const db = makeFakeDb();
  await assert.rejects(() => runScheduledLegsSync({ lf, db, now: NOW, monthStarts: [1000] }), /LF down/);
  assert.equal(db.statusCalls.length, 1);
  assert.equal(db.statusCalls[0].status, 'error');
  assert.match(db.statusCalls[0].message, /LF down/);
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `node --test backend/src/scheduling/runScheduledLegsSync.test.js` — Expected: FAIL, cannot find module `./runScheduledLegsSync.js`.

- [ ] **Step 3: Write the implementation.** Create `backend/src/scheduling/runScheduledLegsSync.js`:

```js
// backend/src/scheduling/runScheduledLegsSync.js
//
// Orchestrates one sync pass of LevelFlight scheduled legs into the mirror.
// Dependency-injected (lf + db adapters) so it is fully unit-testable; the real
// adapters and the setInterval worker live in the next plan.
//
// Flow: fetch each month bucket -> map -> upsert trips -> resolve leg.trip_id ->
// upsert legs -> resolve crew.leg_id -> upsert crew -> record sync status.
// Upserts run parent-before-child so foreign keys always resolve, and each entity
// goes through reconcileBatch so locally-modified rows are never overwritten.
import { reconcileBatch } from './reconcileBatch.js';
import { mapScheduledLegs } from './mapScheduledLegs.js';
import { attachFk } from './attachFk.js';

function uniqueByLfOid(records) {
  const m = new Map();
  for (const r of records) if (!m.has(r.lfOid)) m.set(r.lfOid, r);
  return [...m.values()];
}

// Reconcile a page of incoming records against existing mirror rows and upsert
// the results. Returns Map<lfOid, uuid> for the rows now in the table.
async function syncEntity(db, table, incoming, now) {
  if (incoming.length === 0) return new Map();
  const existing = await db.existingByLfOid(table, incoming.map((r) => r.lfOid));
  const ops = reconcileBatch(incoming, existing, now);
  const upserted = await db.upsert(table, ops.map((op) => op.set));
  const idByLfOid = new Map();
  for (const row of upserted) idByLfOid.set(row.lf_oid, row.id);
  return idByLfOid;
}

export async function runScheduledLegsSync({ lf, db, now, monthStarts }) {
  try {
    const rawLegs = [];
    for (const start of monthStarts) {
      const page = await lf.scheduledLegs(start);
      if (Array.isArray(page)) rawLegs.push(...page);
    }

    const mapped = mapScheduledLegs(rawLegs);
    const trips = uniqueByLfOid(mapped.trips);
    const legs = uniqueByLfOid(mapped.legs);
    const crew = uniqueByLfOid(mapped.crew);

    const tripIdByLfOid = await syncEntity(db, 'scheduling_trips', trips, now);

    const legsWithFk = attachFk(legs, 'trip_id', (r) => r.ref.tripLfOid, tripIdByLfOid);
    const legIdByLfOid = await syncEntity(db, 'scheduling_legs', legsWithFk, now);

    const crewWithFk = attachFk(crew, 'leg_id', (r) => r.ref.legLfOid, legIdByLfOid);
    await syncEntity(db, 'scheduling_crew_assignments', crewWithFk, now);

    const counts = { trips: trips.length, legs: legsWithFk.length, crew: crewWithFk.length };
    await db.recordSyncStatus('scheduledLegs', { status: 'ok', message: null, counts, now });
    return counts;
  } catch (e) {
    const message = e && e.message ? e.message : String(e);
    await db.recordSyncStatus('scheduledLegs', { status: 'error', message, counts: null, now });
    throw e;
  }
}
```

- [ ] **Step 4: Run to verify it passes.** Run: `node --test backend/src/scheduling/runScheduledLegsSync.test.js` — Expected: PASS, all 3 tests pass.

- [ ] **Step 5: Commit.**

```bash
git add backend/src/scheduling/runScheduledLegsSync.js backend/src/scheduling/runScheduledLegsSync.test.js
git commit -m "feat(scheduling): scheduledLegs sync orchestrator (injected adapters)"
```

---

### Task 4: `syncWindow` — month buckets for the −30/+90-day window

**Files:**
- Create: `backend/src/scheduling/syncWindow.test.js`
- Create: `backend/src/scheduling/syncWindow.js`

- [ ] **Step 1: Write the failing test.** Create `backend/src/scheduling/syncWindow.test.js`:

```js
// backend/src/scheduling/syncWindow.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMonthStarts } from './syncWindow.js';

test('computeMonthStarts covers the months spanning -30d..+90d', () => {
  const now = Date.UTC(2026, 5, 18); // 2026-06-18 (month index 5 = June)
  const starts = computeMonthStarts(now);
  // -30d -> 2026-05-19 (May); +90d -> ~2026-09-16 (Sep). Months: May..Sep = 5 buckets.
  assert.deepEqual(starts, [
    Date.UTC(2026, 4, 1), // May 1
    Date.UTC(2026, 5, 1), // Jun 1
    Date.UTC(2026, 6, 1), // Jul 1
    Date.UTC(2026, 7, 1), // Aug 1
    Date.UTC(2026, 8, 1), // Sep 1
  ]);
});

test('computeMonthStarts honors custom back/forward windows', () => {
  const now = Date.UTC(2026, 0, 15); // 2026-01-15
  const starts = computeMonthStarts(now, { backDays: 0, fwdDays: 0 });
  assert.deepEqual(starts, [Date.UTC(2026, 0, 1)]); // just January
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `node --test backend/src/scheduling/syncWindow.test.js` — Expected: FAIL, cannot find module `./syncWindow.js`.

- [ ] **Step 3: Write the implementation.** Create `backend/src/scheduling/syncWindow.js`:

```js
// backend/src/scheduling/syncWindow.js
//
// Pure: compute the UTC first-of-month timestamps to fetch, covering the rolling
// window [now - backDays, now + fwdDays]. LevelFlight's /api/analytics/scheduledLegs
// returns one month per start timestamp, so we fetch one bucket per month touched.
const DAY_MS = 86400000;

export function computeMonthStarts(nowMs, { backDays = 30, fwdDays = 90 } = {}) {
  const startDate = new Date(nowMs - backDays * DAY_MS);
  const end = nowMs + fwdDays * DAY_MS;
  let y = startDate.getUTCFullYear();
  let m = startDate.getUTCMonth();
  const out = [];
  for (let t = Date.UTC(y, m, 1); t <= end; t = Date.UTC(y, m, 1)) {
    out.push(t);
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes.** Run: `node --test backend/src/scheduling/syncWindow.test.js` — Expected: PASS, both tests pass.

- [ ] **Step 5: Run the whole scheduling suite.** Run: `node --test backend/src/scheduling/*.test.js` — Expected: PASS (all existing tests plus the new attachFk, orchestrator, and syncWindow tests).

- [ ] **Step 6: Commit.**

```bash
git add backend/src/scheduling/syncWindow.js backend/src/scheduling/syncWindow.test.js
git commit -m "feat(scheduling): compute month buckets for the sync window"
```

---

## Next plan (not in scope here) — the I/O shell

The wiring plan adds the real adapters and turns this core into a running sync:
- `backend/src/scheduling/syncLf.js` — `scheduledLegs(start)` = `unwrapArray(await lfPost('/api/analytics/scheduledLegs', { start }), ['legs','scheduledLegs','data','items','results'])`, reusing `lfPost` from `backend/src/agent/providers/levelflight.js`.
- `backend/src/scheduling/syncDb.js` — Supabase adapter using `supabase` from `backend/src/services/supabase.js`: `existingByLfOid` (`.select('lf_oid, locally_modified, lf_synced_snapshot, upstream_changed').in('lf_oid', oids)`), `upsert` (`.upsert(rows, { onConflict: 'lf_oid' }).select('id, lf_oid')`), `recordSyncStatus` (`.upsert` into `scheduling_sync_status` on `entity`).
- `backend/src/scheduling/syncWorker.js` — `startSyncWorker()`: build `monthStarts` via `computeMonthStarts(Date.now())`, call `runScheduledLegsSync`, soft-fail, repeat on `setInterval` (~5 min), started-guard — mirroring `startReconciler`.
- `backend/src/routes/scheduling.js` — `GET /sync-status` → read `scheduling_sync_status`, wrap each with `freshnessLabel(last_success_at, new Date().toISOString())`.
- `backend/src/index.js` — import + mount `app.use('/api/scheduling', schedulingRoutes)` (auto-protected by the `/api` guard) and call `startSyncWorker()` in the `app.listen` callback.
- Manual smoke test: start the backend, confirm a `scheduling_sync_status` row appears and `scheduling_trips`/`legs` populate from real LevelFlight data.
