# Scheduling — Edit & Revert Trip Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The first write capability — let a dispatcher change a trip's status in the Scheduling section. Edits are saved to the mirror as a **local override** (never touching LevelFlight) and can be **reverted to LevelFlight** with one click. This proves the native-edit / provenance / revert model and surfaces the correct dispatch-status labels (Booked / Closed / In Progress).

**Architecture:** First editing slice of the scheduling-dispatcher-web sub-project (spec: `docs/superpowers/specs/2026-06-18-scheduling-dispatcher-web-design.md`). Backend: two pure helpers (the dispatch-status label map; rebuild trip columns from the snapshot for revert) plus three routes on `/api/scheduling` (GET one trip, PATCH status, POST revert). Editing a mirrored trip writes the working-copy `status` column and sets `locally_modified = true`; revert restores the columns from `lf_synced_snapshot` and clears the flag — exactly the model in the spec. Frontend: parameterize the shared `TripsList` so the Scheduling list opens trips in a new editable `SchedulingTripDetail` (status dropdown + Revert), instead of the read-only `/trips/:id`.

**Tech Stack:** Backend Node/Express + Supabase, `node:test`. Frontend React 19 + Vite, verified by `npm run build` + a manual visual check. The pure helpers are TDD'd; the routes are syntax-checked and live-verified by the controller against the real mirror after implementation.

**Status enum (confirmed against live data):** `0 = Booked`, `2 = Closed`, `4 = In Progress` (LevelFlight dispatch status; distinct from the per-leg status enum the read-only list components use).

---

## File Structure

- `backend/src/scheduling/dispatchStatus.js` (+ test) — **new.** Pure: status label map + editable-status check.
- `backend/src/scheduling/tripFromSnapshot.js` (+ test) — **new.** Pure: rebuild trip columns from a dispatch snapshot (for revert).
- `backend/src/routes/scheduling.js` — **modify.** Add `GET/PATCH /trips/:lfOid` and `POST /trips/:lfOid/revert`.
- `frontend/src/components/TripsList.jsx` — **modify.** Add optional `basePath` prop for the trip link.
- `frontend/src/pages/SchedulingTripDetail.jsx` — **new.** Editable trip view (status + revert).
- `frontend/src/App.jsx` — **modify.** Add `/scheduling/trips/:id` route.
- `frontend/src/pages/Scheduling.jsx` — **modify.** Pass `basePath="/scheduling/trips"` to the Trips list.

---

### Task 1: Dispatch-status helper (pure)

**Files:**
- Create: `backend/src/scheduling/dispatchStatus.test.js`
- Create: `backend/src/scheduling/dispatchStatus.js`

- [ ] **Step 1: Write the failing test.** Create `backend/src/scheduling/dispatchStatus.test.js`:

```js
// backend/src/scheduling/dispatchStatus.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatchStatusLabel, isEditableStatus } from './dispatchStatus.js';

test('dispatchStatusLabel maps known codes and falls back', () => {
  assert.equal(dispatchStatusLabel(0), 'Booked');
  assert.equal(dispatchStatusLabel(2), 'Closed');
  assert.equal(dispatchStatusLabel(4), 'In Progress');
  assert.equal(dispatchStatusLabel(null), '—');
  assert.equal(dispatchStatusLabel(99), 'Status 99');
});

test('isEditableStatus accepts only known codes', () => {
  assert.equal(isEditableStatus(0), true);
  assert.equal(isEditableStatus(2), true);
  assert.equal(isEditableStatus(4), true);
  assert.equal(isEditableStatus(1), false);
  assert.equal(isEditableStatus('2'), false); // numbers only
  assert.equal(isEditableStatus(undefined), false);
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `node --test backend/src/scheduling/dispatchStatus.test.js` — Expected: FAIL, cannot find module.

- [ ] **Step 3: Write the implementation.** Create `backend/src/scheduling/dispatchStatus.js`:

```js
// backend/src/scheduling/dispatchStatus.js
//
// LevelFlight dispatch (trip) status enum, confirmed against live data.
// Distinct from the per-leg status enum used by the read-only list components.
export const DISPATCH_STATUS_LABELS = { 0: 'Booked', 2: 'Closed', 4: 'In Progress' };

export function dispatchStatusLabel(code) {
  if (Object.prototype.hasOwnProperty.call(DISPATCH_STATUS_LABELS, code)) {
    return DISPATCH_STATUS_LABELS[code];
  }
  return code == null ? '—' : `Status ${code}`;
}

// Only codes a dispatcher may set in this slice (must be a number we know).
export function isEditableStatus(code) {
  return typeof code === 'number' && Object.prototype.hasOwnProperty.call(DISPATCH_STATUS_LABELS, code);
}
```

- [ ] **Step 4: Run to verify it passes.** Run: `node --test backend/src/scheduling/dispatchStatus.test.js` — Expected: PASS, both tests.

- [ ] **Step 5: Commit.**

```bash
git add backend/src/scheduling/dispatchStatus.js backend/src/scheduling/dispatchStatus.test.js
git commit -m "feat(scheduling): dispatch status label map + editable check"
```

---

### Task 2: Rebuild trip columns from snapshot (pure)

**Files:**
- Create: `backend/src/scheduling/tripFromSnapshot.test.js`
- Create: `backend/src/scheduling/tripFromSnapshot.js`

- [ ] **Step 1: Write the failing test.** Create `backend/src/scheduling/tripFromSnapshot.test.js`:

```js
// backend/src/scheduling/tripFromSnapshot.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tripColumnsFromSnapshot } from './tripFromSnapshot.js';

test('tripColumnsFromSnapshot rebuilds trip columns from a dispatch snapshot', () => {
  const snapshot = {
    status: 2,
    tripId: 25104,
    aircraft: { _id: { $oid: 'acN69' } },
    client: { company: { _id: { $oid: 'co1' } }, customer: { _id: { $oid: 'cust1' } } },
  };
  assert.deepEqual(tripColumnsFromSnapshot(snapshot), {
    status: 2,
    trip_number: '25104',
    aircraft_lf_oid: 'acN69',
    company_lf_oid: 'co1',
    customer_lf_oid: 'cust1',
  });
});

test('tripColumnsFromSnapshot is null-safe', () => {
  assert.deepEqual(tripColumnsFromSnapshot(null), {
    status: null, trip_number: null, aircraft_lf_oid: null, company_lf_oid: null, customer_lf_oid: null,
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `node --test backend/src/scheduling/tripFromSnapshot.test.js` — Expected: FAIL, cannot find module.

- [ ] **Step 3: Write the implementation.** Create `backend/src/scheduling/tripFromSnapshot.js`:

```js
// backend/src/scheduling/tripFromSnapshot.js
//
// Pure: rebuild a trip's working-copy columns from its LevelFlight dispatch
// snapshot. Used by Revert to restore a locally-edited trip to LevelFlight's
// version. Field paths mirror the mapper in mapScheduledLegs.js.
import { oidToStr } from './lfNormalize.js';

export function tripColumnsFromSnapshot(snapshot) {
  const d = snapshot || {};
  return {
    status: d.status ?? null,
    trip_number: d.tripId != null ? String(d.tripId) : null,
    aircraft_lf_oid: oidToStr(d?.aircraft?._id?.$oid) || oidToStr(d?.aircraft?._id) || null,
    company_lf_oid: oidToStr(d?.client?.company?._id?.$oid) || oidToStr(d?.client?.company?._id) || null,
    customer_lf_oid: oidToStr(d?.client?.customer?._id?.$oid) || oidToStr(d?.client?.customer?._id) || null,
  };
}
```

- [ ] **Step 4: Run to verify it passes.** Run: `node --test backend/src/scheduling/tripFromSnapshot.test.js` — Expected: PASS, both tests.

- [ ] **Step 5: Commit.**

```bash
git add backend/src/scheduling/tripFromSnapshot.js backend/src/scheduling/tripFromSnapshot.test.js
git commit -m "feat(scheduling): rebuild trip columns from snapshot for revert"
```

---

### Task 3: Trip read / edit / revert routes

**Files:**
- Modify: `backend/src/routes/scheduling.js`

- [ ] **Step 1: Add imports.** In `backend/src/routes/scheduling.js`, after the existing import of `mirrorLegsFromRows`, add:

```js
import { dispatchStatusLabel, isEditableStatus } from '../scheduling/dispatchStatus.js';
import { tripColumnsFromSnapshot } from '../scheduling/tripFromSnapshot.js';
```

- [ ] **Step 2: Add a shared shaper + the three routes.** Add this block immediately AFTER the existing `router.get('/legs', ...)` handler and BEFORE `export default router;`:

```js
const TRIP_COLS = 'lf_oid, trip_number, status, locally_modified, upstream_changed, lf_synced_snapshot';

// Shape a scheduling_trips row for the API (adds labels + the LF-original status).
function shapeTrip(row) {
  const orig = row.lf_synced_snapshot?.status ?? null;
  return {
    lf_oid: row.lf_oid,
    trip_number: row.trip_number,
    status: row.status,
    status_label: dispatchStatusLabel(row.status),
    original_status: orig,
    original_status_label: dispatchStatusLabel(orig),
    locally_modified: row.locally_modified,
    upstream_changed: row.upstream_changed,
  };
}

// GET /api/scheduling/trips/:lfOid — one trip's status + provenance.
router.get('/trips/:lfOid', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('scheduling_trips').select(TRIP_COLS).eq('lf_oid', req.params.lfOid).single();
    if (error) throw error;
    res.json({ trip: shapeTrip(data) });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// PATCH /api/scheduling/trips/:lfOid — local-override the status (never touches LevelFlight).
router.patch('/trips/:lfOid', async (req, res) => {
  try {
    const status = req.body?.status;
    if (!isEditableStatus(status)) return res.status(400).json({ error: 'invalid status' });
    const { data, error } = await supabase
      .from('scheduling_trips')
      .update({ status, locally_modified: true, modified_at: new Date().toISOString(), modified_by: req.user?.email || null })
      .eq('lf_oid', req.params.lfOid)
      .select(TRIP_COLS).single();
    if (error) throw error;
    res.json({ trip: shapeTrip(data) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// POST /api/scheduling/trips/:lfOid/revert — restore the working copy from the LF snapshot.
router.post('/trips/:lfOid/revert', async (req, res) => {
  try {
    const { data: cur, error: e1 } = await supabase
      .from('scheduling_trips').select('lf_synced_snapshot').eq('lf_oid', req.params.lfOid).single();
    if (e1) throw e1;
    const cols = tripColumnsFromSnapshot(cur.lf_synced_snapshot);
    const { data, error } = await supabase
      .from('scheduling_trips')
      .update({ ...cols, locally_modified: false, upstream_changed: false, modified_by: null, modified_at: new Date().toISOString() })
      .eq('lf_oid', req.params.lfOid)
      .select(TRIP_COLS).single();
    if (error) throw error;
    res.json({ trip: shapeTrip(data) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
```

(`supabase` and `req.user` are already available in this file / via the global `/api` auth guard.)

- [ ] **Step 3: Syntax-check.** Run: `node --check backend/src/routes/scheduling.js` — Expected: no output.

- [ ] **Step 4: Run the scheduling unit suite (nothing regressed).** Run: `node --test backend/src/scheduling/*.test.js` — Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add backend/src/routes/scheduling.js
git commit -m "feat(scheduling): trip read/edit-status/revert endpoints"
```

> Controller note: after this task, the controller live-verifies against the real mirror — PATCH a trip's status (assert `locally_modified=true` + new status persisted), then POST revert (assert status restored + `locally_modified=false`).

---

### Task 4: Parameterize TripsList's trip link

**Files:**
- Modify: `frontend/src/components/TripsList.jsx`

- [ ] **Step 1: Read** `frontend/src/components/TripsList.jsx` and find the component's function signature (currently `export default function TripsList({ legs = [], loading = false })`) and the trip-open navigation (currently `navigate(`/trips/${t.dispatchId}`, { state: { trip: t } })`).

- [ ] **Step 2: Add the `basePath` prop.** Replace the function signature:

```jsx
export default function TripsList({ legs = [], loading = false })
```

with:

```jsx
export default function TripsList({ legs = [], loading = false, basePath = '/trips' })
```

- [ ] **Step 3: Use it in the navigation.** Replace:

```jsx
navigate(`/trips/${t.dispatchId}`, { state: { trip: t } })
```

with:

```jsx
navigate(`${basePath}/${t.dispatchId}`, { state: { trip: t } })
```

(If either exact string isn't found verbatim, STOP and report BLOCKED with what you see.) Change nothing else.

- [ ] **Step 4: Build.** Run: `cd frontend && npm run build` — Expected: success (exit 0). The existing `/flights` Trips list renders `<TripsList ...>` with no `basePath`, so it still links to `/trips/:id` — unchanged.

- [ ] **Step 5: Commit.**

```bash
git add frontend/src/components/TripsList.jsx
git commit -m "feat(scheduling): TripsList accepts optional basePath for trip links"
```

---

### Task 5: Editable SchedulingTripDetail + route + wiring

**Files:**
- Create: `frontend/src/pages/SchedulingTripDetail.jsx`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/pages/Scheduling.jsx`

- [ ] **Step 1: Create the page.** Create `frontend/src/pages/SchedulingTripDetail.jsx` with EXACTLY this content:

```jsx
import { useEffect, useState, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import FlightsList from '../components/FlightsList';

// Dispatch status options a dispatcher can set (must match the backend enum).
const STATUS_OPTIONS = [
  { code: 0, label: 'Booked', color: '#a855f7' },
  { code: 4, label: 'In Progress', color: '#f59e0b' },
  { code: 2, label: 'Closed', color: '#22c55e' },
];
const HIDE = new Set(['aircraft']);

export default function SchedulingTripDetail() {
  const { id } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();
  const trip = state?.trip && state.trip.dispatchId === id ? state.trip : null; // legs for display
  const [meta, setMeta] = useState(null);   // status + provenance from the backend
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/scheduling/trips/${id}`);
      const j = await r.json();
      if (j.trip) setMeta(j.trip); else setError(j.error || 'Trip not found');
    } catch (e) { setError(e.message); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (code) => {
    setBusy(true); setError(null);
    try {
      await apiFetch(`/api/scheduling/trips/${id}`, { method: 'PATCH', body: JSON.stringify({ status: Number(code) }) });
      await load();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const revert = async () => {
    setBusy(true); setError(null);
    try {
      await apiFetch(`/api/scheduling/trips/${id}/revert`, { method: 'POST' });
      await load();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const title = trip?.routeSummary || (meta?.trip_number ? `Trip #${meta.trip_number}` : 'Trip');

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/scheduling')}
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13 }}>← Scheduling</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
            {meta?.trip_number ? `Trip #${meta.trip_number}` : ''}{trip?.tail ? ` · ${trip.tail}` : ''}{trip?.client ? ` · ${trip.client}` : ''}
          </p>
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '12px 16px', color: 'var(--danger)', marginBottom: 16 }}>{error}</div>
      )}

      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Status</label>
        <select value={meta?.status ?? ''} disabled={busy || !meta} onChange={(e) => setStatus(e.target.value)}
          style={{ padding: '8px 12px', fontSize: 13, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8 }}>
          {STATUS_OPTIONS.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
        {meta?.locally_modified && (
          <>
            <span style={{ fontSize: 12, color: '#f59e0b', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 20, padding: '3px 10px' }}>
              Edited locally · LevelFlight: {meta.original_status_label}
            </span>
            <button onClick={revert} disabled={busy}
              style={{ padding: '6px 12px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>⟲ Revert to LevelFlight</button>
          </>
        )}
      </div>

      {trip?.legs ? <FlightsList legs={trip.legs} hideColumns={HIDE} /> : (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Open this trip from the Scheduling list to see its legs.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the route to `frontend/src/App.jsx`.** Add the import alongside the other page imports:

```jsx
import SchedulingTripDetail from './pages/SchedulingTripDetail';
```

Then add this route immediately AFTER the existing `<Route path="/scheduling" element={<Scheduling />} />` line:

```jsx
        <Route path="/scheduling/trips/:id" element={<SchedulingTripDetail />} />
```

- [ ] **Step 3: Point the Scheduling Trips list at the new route.** In `frontend/src/pages/Scheduling.jsx`, find the line that renders the trips list inside `TripsView` (currently `: <TripsList legs={shown} loading={loading} />`) and replace it with:

```jsx
        : <TripsList legs={shown} loading={loading} basePath="/scheduling/trips" />}
```

(If the exact string isn't found, STOP and report BLOCKED.)

- [ ] **Step 4: Build.** Run: `cd frontend && npm run build` — Expected: success (exit 0).

- [ ] **Step 5: Commit.**

```bash
git add frontend/src/pages/SchedulingTripDetail.jsx frontend/src/App.jsx frontend/src/pages/Scheduling.jsx
git commit -m "feat(scheduling): editable trip status with revert in the Scheduling section"
```

- [ ] **Step 6: Manual visual check (human-run).** Start backend + frontend, open **Scheduling → Trips**, click a trip. Expected: the new trip page opens with a **Status** dropdown (Booked / In Progress / Closed). Change it → the page shows an **"Edited locally · LevelFlight: <original>"** badge and a **⟲ Revert to LevelFlight** button. Click Revert → status returns to LevelFlight's value and the badge disappears. (Edits never reach LevelFlight — they live only in your mirror.)

---

## Done

This is the first write capability: edit a trip's status, kept as a local override, revertible to LevelFlight. It proves the provenance/revert model the whole parallel-build phase depends on. Next: extend editing to more trip fields and legs (the trip builder proper), then native trip creation.
