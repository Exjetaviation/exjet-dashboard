# Scheduling Sync Wiring (I/O Shell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the already-built, unit-tested orchestration core to live LevelFlight and Supabase so the one-way mirror actually runs: real adapters, a background worker (opt-in via env flag), and a `GET /api/scheduling/sync-status` route — verified by a manual smoke test.

**Architecture:** Final piece of Slice 1 of the scheduling-dispatcher-web sub-project (spec: `docs/superpowers/specs/2026-06-18-scheduling-dispatcher-web-design.md`). The orchestrator `runScheduledLegsSync({ lf, db, now, monthStarts })` and helpers (`reconcileBatch`, `mapScheduledLegs`, `attachFk`, `computeMonthStarts`, `freshnessLabel`) already exist and are tested in `backend/src/scheduling/`. This plan adds the thin I/O adapters that fulfill the injected `lf`/`db` interfaces, the `setInterval` worker (mirroring the existing `startReconciler`), the status route, and the `index.js` wiring. These touch live services so they can't be unit-tested; the one pure seam (decorating status rows with freshness) is unit-tested, the rest is syntax-checked and validated by a manual smoke test.

**Tech Stack:** Node 20 (ESM), Express, `@supabase/supabase-js`, `node:test`. Reuses `lfPost` from `backend/src/agent/providers/levelflight.js` (Cognito auth/refresh) and `supabase` from `backend/src/services/supabase.js`. Run tests from the repo root: `node --test backend/src/scheduling/*.test.js`.

**Safety:** The worker is **opt-in**. `startSyncWorker()` returns immediately unless `process.env.SCHEDULING_SYNC === 'on'`, so deploying/starting the backend does not begin calling LevelFlight or writing the mirror until you set that env var.

---

## File Structure

- `backend/src/scheduling/formatSyncStatus.js` — **new.** Pure: decorate sync_status rows with a `freshnessLabel`.
- `backend/src/scheduling/formatSyncStatus.test.js` — **new.** Unit tests.
- `backend/src/scheduling/syncLf.js` — **new.** Real `lf` adapter: `scheduledLegs(startMs)` via `lfPost`.
- `backend/src/scheduling/syncDb.js` — **new.** Real `db` adapter over Supabase: `existingByLfOid`, `upsert`, `recordSyncStatus`.
- `backend/src/scheduling/syncWorker.js` — **new.** `syncNow()` + `startSyncWorker()` (opt-in, `setInterval`).
- `backend/src/routes/scheduling.js` — **new.** `GET /sync-status`.
- `backend/src/index.js` — **modify.** Import + mount route + start worker.

---

### Task 1: `formatSyncStatus` (pure, the one testable seam)

**Files:**
- Create: `backend/src/scheduling/formatSyncStatus.test.js`
- Create: `backend/src/scheduling/formatSyncStatus.js`

- [ ] **Step 1: Write the failing test.** Create `backend/src/scheduling/formatSyncStatus.test.js`:

```js
// backend/src/scheduling/formatSyncStatus.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSyncStatus } from './formatSyncStatus.js';

const NOW = '2026-06-18T19:00:00.000Z';

test('formatSyncStatus adds a freshness label per row', () => {
  const rows = [
    { entity: 'scheduledLegs', last_success_at: '2026-06-18T18:58:00.000Z', status: 'ok' },
    { entity: 'other', last_success_at: null, status: 'error' },
  ];
  const out = formatSyncStatus(rows, NOW);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].freshness, { state: 'fresh', text: 'Synced 2 min ago' });
  assert.equal(out[0].entity, 'scheduledLegs'); // original fields preserved
  assert.deepEqual(out[1].freshness, { state: 'unknown', text: 'Never synced' });
});

test('formatSyncStatus returns an empty array for no rows', () => {
  assert.deepEqual(formatSyncStatus([], NOW), []);
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `node --test backend/src/scheduling/formatSyncStatus.test.js` — Expected: FAIL, cannot find module `./formatSyncStatus.js`.

- [ ] **Step 3: Write the implementation.** Create `backend/src/scheduling/formatSyncStatus.js`:

```js
// backend/src/scheduling/formatSyncStatus.js
//
// Pure: decorate each scheduling_sync_status row with a human freshness label
// derived from its last successful sync time. Used by the sync-status route.
import { freshnessLabel } from './freshness.js';

export function formatSyncStatus(rows, now) {
  return rows.map((r) => ({
    ...r,
    freshness: freshnessLabel(r.last_success_at ?? null, now),
  }));
}
```

- [ ] **Step 4: Run to verify it passes.** Run: `node --test backend/src/scheduling/formatSyncStatus.test.js` — Expected: PASS, both tests pass.

- [ ] **Step 5: Commit.**

```bash
git add backend/src/scheduling/formatSyncStatus.js backend/src/scheduling/formatSyncStatus.test.js
git commit -m "feat(scheduling): freshness-decorate sync status rows"
```

---

### Task 2: Real `lf` and `db` adapters

**Files:**
- Create: `backend/src/scheduling/syncLf.js`
- Create: `backend/src/scheduling/syncDb.js`

These hit live services, so they are verified by `node --check` (syntax) here and by the smoke test in Task 3 — no unit tests.

- [ ] **Step 1: Write the LevelFlight adapter.** Create `backend/src/scheduling/syncLf.js`:

```js
// backend/src/scheduling/syncLf.js
//
// Real `lf` adapter for the sync orchestrator. Fetches one month of scheduled
// legs from LevelFlight, reusing the dashboard's authenticated lfPost (Cognito
// token refresh handled there). Returns a bare array of raw legs.
import { lfPost } from '../agent/providers/levelflight.js';
import { unwrapArray } from './lfNormalize.js';

export const syncLf = {
  async scheduledLegs(startMs) {
    const payload = await lfPost('/api/analytics/scheduledLegs', { start: startMs });
    return unwrapArray(payload, ['legs', 'scheduledLegs', 'data', 'items', 'results']);
  },
};
```

- [ ] **Step 2: Syntax-check it.** Run: `node --check backend/src/scheduling/syncLf.js` — Expected: no output (valid).

- [ ] **Step 3: Write the Supabase adapter.** Create `backend/src/scheduling/syncDb.js`:

```js
// backend/src/scheduling/syncDb.js
//
// Real `db` adapter for the sync orchestrator, over Supabase (service role).
// Fulfills the interface runScheduledLegsSync expects:
//   existingByLfOid(table, lfOids) -> Map<lf_oid, { locally_modified, lf_synced_snapshot, upstream_changed }>
//   upsert(table, rows)            -> Array<{ id, lf_oid }>
//   recordSyncStatus(entity, info) -> void
import { supabase } from '../services/supabase.js';

export const syncDb = {
  async existingByLfOid(table, lfOids) {
    const m = new Map();
    if (!lfOids.length) return m;
    const { data, error } = await supabase
      .from(table)
      .select('lf_oid, locally_modified, lf_synced_snapshot, upstream_changed')
      .in('lf_oid', lfOids);
    if (error) throw new Error(`existingByLfOid(${table}): ${error.message}`);
    for (const r of data || []) m.set(r.lf_oid, r);
    return m;
  },

  async upsert(table, rows) {
    if (!rows.length) return [];
    const { data, error } = await supabase
      .from(table)
      .upsert(rows, { onConflict: 'lf_oid' })
      .select('id, lf_oid');
    if (error) throw new Error(`upsert(${table}): ${error.message}`);
    return data || [];
  },

  async recordSyncStatus(entity, { status, message, counts, now }) {
    const row = { entity, last_run_at: now, status, message, counts };
    if (status === 'ok') row.last_success_at = now;
    const { error } = await supabase
      .from('scheduling_sync_status')
      .upsert(row, { onConflict: 'entity' });
    if (error) throw new Error(`recordSyncStatus: ${error.message}`);
  },
};
```

- [ ] **Step 4: Syntax-check it.** Run: `node --check backend/src/scheduling/syncDb.js` — Expected: no output (valid).

- [ ] **Step 5: Commit.**

```bash
git add backend/src/scheduling/syncLf.js backend/src/scheduling/syncDb.js
git commit -m "feat(scheduling): real LevelFlight + Supabase sync adapters"
```

---

### Task 3: Worker, route, and index wiring + smoke test

**Files:**
- Create: `backend/src/scheduling/syncWorker.js`
- Create: `backend/src/routes/scheduling.js`
- Modify: `backend/src/index.js`

- [ ] **Step 1: Write the worker.** Create `backend/src/scheduling/syncWorker.js`:

```js
// backend/src/scheduling/syncWorker.js
//
// Background worker that runs the scheduled-legs mirror on an interval, mirroring
// the existing startRecorder/startReconciler pattern. Opt-in: does nothing unless
// SCHEDULING_SYNC=on, so starting the backend doesn't hit LevelFlight until enabled.
import { runScheduledLegsSync } from './runScheduledLegsSync.js';
import { computeMonthStarts } from './syncWindow.js';
import { syncLf } from './syncLf.js';
import { syncDb } from './syncDb.js';

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes
let started = false;

export async function syncNow() {
  const now = new Date().toISOString();
  const monthStarts = computeMonthStarts(Date.now());
  return runScheduledLegsSync({ lf: syncLf, db: syncDb, now, monthStarts });
}

export function startSyncWorker() {
  if (process.env.SCHEDULING_SYNC !== 'on') return; // opt-in
  if (started) return;
  started = true;
  const run = () =>
    syncNow().catch((e) => console.warn('[scheduling sync] failed:', e?.message || e));
  run();
  setInterval(run, SYNC_INTERVAL_MS);
}
```

- [ ] **Step 2: Syntax-check it.** Run: `node --check backend/src/scheduling/syncWorker.js` — Expected: no output (valid).

- [ ] **Step 3: Write the route.** Create `backend/src/routes/scheduling.js`:

```js
// backend/src/routes/scheduling.js
import express from 'express';
import { supabase } from '../services/supabase.js';
import { formatSyncStatus } from '../scheduling/formatSyncStatus.js';

const router = express.Router();

// GET /api/scheduling/sync-status — mirror freshness for the dashboard indicator.
router.get('/sync-status', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('scheduling_sync_status')
      .select('entity, last_run_at, last_success_at, status, message, counts');
    if (error) throw error;
    res.json({ entities: formatSyncStatus(data || [], new Date().toISOString()) });
  } catch (e) {
    res.status(502).json({ error: e.message, entities: [] });
  }
});

export default router;
```

- [ ] **Step 4: Syntax-check it.** Run: `node --check backend/src/routes/scheduling.js` — Expected: no output (valid).

- [ ] **Step 5: Wire into `backend/src/index.js`.** Make exactly these three edits.

Edit A — add imports. Replace:

```js
import { startReconciler } from './services/flightTrackReconciler.js';
```

with:

```js
import { startReconciler } from './services/flightTrackReconciler.js';
import schedulingRoutes from './routes/scheduling.js';
import { startSyncWorker } from './scheduling/syncWorker.js';
```

Edit B — mount the route (auto-protected by the existing `/api` auth guard). Replace:

```js
app.use('/api/adsb', adsbRoutes);
```

with:

```js
app.use('/api/adsb', adsbRoutes);
app.use('/api/scheduling', schedulingRoutes);
```

Edit C — start the worker on boot. Replace:

```js
  startRecorder();
  startReconciler();
});
```

with:

```js
  startRecorder();
  startReconciler();
  startSyncWorker();
});
```

- [ ] **Step 6: Syntax-check index.js.** Run: `node --check backend/src/index.js` — Expected: no output (valid).

- [ ] **Step 7: Run the full scheduling suite (nothing regressed).** Run: `node --test backend/src/scheduling/*.test.js` — Expected: PASS (all existing tests plus the new formatSyncStatus tests).

- [ ] **Step 8: Commit.**

```bash
git add backend/src/scheduling/syncWorker.js backend/src/routes/scheduling.js backend/src/index.js
git commit -m "feat(scheduling): sync worker, status route, and index wiring"
```

- [ ] **Step 9: Manual smoke test (human-run — requires LevelFlight + Supabase env).**

This step is run by the human, not the agent. From `backend/`, with the existing `.env` (LEVELFLIGHT_* and SUPABASE_* present), enable the worker and start the server:

```bash
SCHEDULING_SYNC=on npm run dev
```

Within ~30 seconds, verify in the Supabase SQL editor:

```sql
select * from scheduling_sync_status;                 -- one 'scheduledLegs' row, status 'ok', counts populated
select count(*) from scheduling_trips;                -- > 0
select count(*) from scheduling_legs;                 -- > 0
select status, trip_number, aircraft_lf_oid from scheduling_trips limit 5;
```

Expected: a `scheduling_sync_status` row with `status = 'ok'` and non-null `counts`, and real LevelFlight trips/legs mirrored into the tables. If `status = 'error'`, read its `message` column for the failure. Leave `SCHEDULING_SYNC` unset in normal runs until you're ready for continuous mirroring.

---

## Done

With this merged and `SCHEDULING_SYNC=on`, the one-way LevelFlight→Supabase mirror runs every 5 minutes, protecting any local edits. That completes the read-foundation of Slice 1. Next slices: passengers (dispatch-detail endpoint), then the read UI (Schedule board + Trips list/detail reusing dashboard components).
