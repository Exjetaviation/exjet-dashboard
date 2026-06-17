# Per-Flight Track Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each flight's real ADS-B flown path on its detail page, backed by permanent per-flight snapshots captured by a background reconciler, with a live fallback for in-progress flights.

**Architecture:** A periodic reconciler fetches completed LevelFlight legs, clips each leg's track from the rolling `adsb_positions` table, and upserts a compact, permanent row into a new `flight_tracks` table (keyed by leg id). A new `GET /api/adsb/flight-track/:legId` endpoint serves that snapshot, or a live clip of raw positions for flights still in progress. The flight detail page renders a standalone `FlightTrackMap` Leaflet component. After a one-time 90-day backfill, raw-position retention drops from 90 to 14 days.

**Tech Stack:** Node/Express (ESM), Supabase (`@supabase/supabase-js`), `node:test`, React + Vite, Leaflet.

---

## File Structure

**Backend**
- `backend/migrations/007_flight_tracks.sql` (new) — permanent snapshot table (already created in Supabase; file documents/reproduces it).
- `backend/src/services/adsbTrack.js` (modify) — add PURE helpers `monthAnchors`, `legTail`, `selectCompletedLegs`, `selectLegsToSnapshot`. Unit-tested.
- `backend/src/services/flightTrackStore.js` (new) — soft-failing Supabase access: `getFlightTrack`, `getStoredLegIds`, `upsertFlightTrack`. Mirrors `adsbStore.js`.
- `backend/src/services/flightTrackReconciler.js` (new) — periodic capture job: `runReconcile({days})` + `startReconciler()`.
- `backend/src/routes/adsb.js` (modify) — import shared helpers (drop the local `monthAnchors`), add `GET /flight-track/:legId`.
- `backend/src/index.js` (modify) — call `startReconciler()` after `startRecorder()`.
- `backend/src/services/adsbRecorder.js` (modify) — `RETENTION_DAYS` 90 → 14 (LAST, after backfill).

**Frontend**
- `frontend/src/components/FlightTrackMap.jsx` (new) — standalone Leaflet map for one flight's track.
- `frontend/src/hooks/useAdsb.js` (modify) — add `fetchFlightTrack`.
- `frontend/src/pages/FlightDetail.jsx` (modify) — fetch + render `FlightTrackMap` full-width below the header.

---

## Task 1: Migration — `flight_tracks` table

**Files:**
- Create: `backend/migrations/007_flight_tracks.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 007_flight_tracks.sql
-- Permanent per-flight ADS-B track snapshots for the flight detail map. Written
-- once per completed flight by the reconciler (src/services/flightTrackReconciler.js),
-- keyed by the LevelFlight leg id. NEVER pruned — this is the system of record for
-- historical flight paths (the raw adsb_positions firehose is the source, and it
-- prunes to a short rolling window). Soft-fails if Supabase is absent.

create table if not exists public.flight_tracks (
    leg_id        text primary key,
    registration  text not null,
    from_airport  text,
    to_airport    text,
    dep_time      timestamptz,
    arr_time      timestamptz,
    track         jsonb not null default '[]'::jsonb,  -- [[lat,lon], ...]
    point_count   integer not null default 0,
    created_at    timestamptz not null default now()
);

create index if not exists flight_tracks_reg_idx on public.flight_tracks (registration);
```

- [ ] **Step 2: Commit**

```bash
git add backend/migrations/007_flight_tracks.sql
git commit -m "Add flight_tracks migration for permanent per-flight track snapshots"
```

> NOTE: The user already created this table in Supabase. This file documents and reproduces the exact schema the code writes.

---

## Task 2: Pure reconciler helpers + tests

**Files:**
- Modify: `backend/src/services/adsbTrack.js`
- Test: `backend/src/services/adsbTrack.test.js`
- Modify: `backend/src/routes/adsb.js` (use the shared helpers; remove the duplicate `monthAnchors`)

- [ ] **Step 1: Write the failing tests (append to `adsbTrack.test.js`)**

First update the import line at the top of `backend/src/services/adsbTrack.test.js` to include the new names:

```js
import { hasMoved, detectTakeoff, clipTrackToLeg, normReg, monthAnchors, legTail, selectCompletedLegs, selectLegsToSnapshot } from './adsbTrack.js';
```

Then append these tests:

```js
test('monthAnchors covers the window plus the prior month', () => {
  const start = Date.UTC(2026, 5, 10); // Jun 10 2026
  const end = Date.UTC(2026, 5, 20);
  const anchors = monthAnchors(start, end);
  assert.ok(anchors.includes(Date.UTC(2026, 4, 1)), 'includes May (prior month)');
  assert.ok(anchors.includes(Date.UTC(2026, 5, 1)), 'includes June');
});

test('legTail normalizes the leg aircraft tail', () => {
  assert.equal(legTail({ dispatch: { aircraft: { tailNumber: 'n-69fp' } } }), 'N69FP');
  assert.equal(legTail({ aircraft: { tailNumber: 'N100AB' } }), 'N100AB');
  assert.equal(legTail({}), '');
});

test('selectCompletedLegs keeps past, dated, de-duped legs', () => {
  const now = 5000;
  const legs = [
    { _id: { $oid: 'a' }, departure: { time: 1000, airport: 'KAAA' }, arrival: { time: 2000, airport: 'KBBB' }, dispatch: { aircraft: { tailNumber: 'N1' } } },
    { _id: { $oid: 'a' }, departure: { time: 1000, airport: 'KAAA' }, arrival: { time: 2000, airport: 'KBBB' } }, // duplicate id
    { _id: { $oid: 'b' }, departure: { time: 4000, airport: 'KCCC' }, arrival: { time: 9000, airport: 'KDDD' } }, // arrival in the future
    { _id: { $oid: 'c' }, departure: { time: 1000 }, arrival: {} }, // missing arrival time
  ];
  const out = selectCompletedLegs(legs, now);
  assert.deepEqual(out.map((l) => l.id), ['a']);
  assert.equal(out[0].tail, 'N1');
  assert.equal(out[0].from, 'KAAA');
  assert.equal(out[0].to, 'KBBB');
});

test('selectLegsToSnapshot drops already-stored legs', () => {
  const completed = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const out = selectLegsToSnapshot(completed, new Set(['b']));
  assert.deepEqual(out.map((l) => l.id), ['a', 'c']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && node --test src/services/adsbTrack.test.js`
Expected: FAIL — `monthAnchors`/`legTail`/`selectCompletedLegs`/`selectLegsToSnapshot` are not exported.

- [ ] **Step 3: Add the helpers to `adsbTrack.js`**

Append to `backend/src/services/adsbTrack.js`:

```js
// Months (UTC, 1st of month) spanning [startMs, endMs], plus the prior month, as
// anchor timestamps for LevelFlight's scheduledLegs queries. Moved here from
// routes/adsb.js so the reconciler can reuse it.
export function monthAnchors(startMs, endMs) {
  const out = []; const d = new Date(startMs);
  let y = d.getUTCFullYear(), m = d.getUTCMonth();
  for (;;) { const t = Date.UTC(y, m, 1); if (t > endMs) break; out.push(t); m++; if (m > 11) { m = 0; y++; } if (out.length > 24) break; }
  out.unshift(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  return out;
}

// Normalized tail number for a LevelFlight leg.
export function legTail(leg) {
  return normReg(leg?.dispatch?.aircraft?.tailNumber || leg?.aircraft?.tailNumber || '');
}

// From raw LevelFlight leg lists, return de-duplicated COMPLETED legs (arrival in
// the past), normalized to { id, tail, from, to, depTime, arrTime }. `now` is
// epoch ms. Pure — no I/O.
export function selectCompletedLegs(legs, now) {
  const seen = new Set();
  const out = [];
  for (const l of legs || []) {
    const id = l?._id?.$oid;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const depTime = l?.departure?.time, arrTime = l?.arrival?.time;
    if (!depTime || !arrTime) continue;
    if (arrTime > now) continue; // not completed yet
    out.push({ id, tail: legTail(l), from: l.departure?.airport, to: l.arrival?.airport, depTime, arrTime });
  }
  return out;
}

// Drop legs whose id is already stored. `existingIds` is a Set. Pure.
export function selectLegsToSnapshot(completedLegs, existingIds) {
  return completedLegs.filter((leg) => !existingIds.has(leg.id));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && node --test src/services/adsbTrack.test.js`
Expected: PASS — all helper tests green (plus the pre-existing ones).

- [ ] **Step 5: Refactor `routes/adsb.js` to use the shared helpers**

In `backend/src/routes/adsb.js`, change the import on line 6 from:

```js
import { clipTrackToLeg, normReg } from '../services/adsbTrack.js';
```
to:
```js
import { clipTrackToLeg, normReg, monthAnchors, legTail } from '../services/adsbTrack.js';
```

Replace the local `eqTail` helper (it referenced the duplicate logic) and DELETE the local `monthAnchors`. The "Local helpers" block near the bottom becomes just:

```js
// Local helpers (small and route-specific).
function eqTail(leg, tail) {
  return legTail(leg) === tail; // `tail` is already normalized by the caller
}
```

(Delete the entire `function monthAnchors(startMs, endMs) { ... }` definition — it now lives in `adsbTrack.js`.)

- [ ] **Step 6: Verify the route still parses and tests pass**

Run: `cd backend && node --check src/routes/adsb.js && node --test src/services/adsbTrack.test.js`
Expected: no syntax error; tests PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/adsbTrack.js backend/src/services/adsbTrack.test.js backend/src/routes/adsb.js
git commit -m "Add pure reconciler helpers; share monthAnchors/legTail with adsb route"
```

---

## Task 3: Soft-failing snapshot store (`flightTrackStore.js`)

**Files:**
- Create: `backend/src/services/flightTrackStore.js`
- Test: `backend/src/services/flightTrackStore.test.js`

- [ ] **Step 1: Write the failing soft-fail test**

```js
// backend/src/services/flightTrackStore.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Force the soft-fail path: no Supabase config. Point dotenv at an empty file so
// importing the module can't repopulate the vars from a local .env.
process.env.DOTENV_CONFIG_PATH = '/dev/null';
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;

const { getFlightTrack, getStoredLegIds, upsertFlightTrack } = await import('./flightTrackStore.js');

test('getFlightTrack returns null with no Supabase', async () => {
  assert.equal(await getFlightTrack('leg1'), null);
});

test('getStoredLegIds returns an empty Set with no Supabase', async () => {
  const s = await getStoredLegIds(['a', 'b']);
  assert.ok(s instanceof Set);
  assert.equal(s.size, 0);
});

test('upsertFlightTrack returns null with no Supabase', async () => {
  assert.equal(await upsertFlightTrack({ leg_id: 'x' }), null);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node --test src/services/flightTrackStore.test.js`
Expected: FAIL — module `./flightTrackStore.js` does not exist.

- [ ] **Step 3: Write the store**

```js
// backend/src/services/flightTrackStore.js
// Soft-failing persistence for permanent per-flight track snapshots. If Supabase
// isn't configured, every function no-ops (returns null/empty Set) so the
// reconciler and endpoints keep working without it. Same pattern as adsbStore.js.

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

let _client = null;
function getClient() {
  if (_client !== null) return _client || null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) { _client = false; return null; }
  try { _client = createClient(url, key); return _client; }
  catch (e) { console.warn('[flightTrackStore] client init failed (soft):', e.message); _client = false; return null; }
}

// One snapshot row by leg id, or null.
export async function getFlightTrack(legId) {
  const client = getClient();
  if (!client || !legId) return null;
  try {
    const { data, error } = await client
      .from('flight_tracks')
      .select('leg_id, registration, from_airport, to_airport, dep_time, arr_time, track, point_count')
      .eq('leg_id', legId)
      .maybeSingle();
    if (error) { console.warn('[flightTrackStore] get failed (soft):', error.message); return null; }
    return data || null;
  } catch (e) { console.warn('[flightTrackStore] get error (soft):', e?.message || e); return null; }
}

// Which of `legIds` already have a stored snapshot. Returns a Set (empty if
// Supabase off / on any error).
export async function getStoredLegIds(legIds) {
  const ids = (legIds || []).filter(Boolean);
  if (!ids.length) return new Set();
  const client = getClient();
  if (!client) return new Set();
  try {
    const { data, error } = await client
      .from('flight_tracks')
      .select('leg_id')
      .in('leg_id', ids);
    if (error) { console.warn('[flightTrackStore] getStoredLegIds failed (soft):', error.message); return new Set(); }
    return new Set((data || []).map((r) => r.leg_id));
  } catch (e) { console.warn('[flightTrackStore] getStoredLegIds error (soft):', e?.message || e); return new Set(); }
}

// Upsert one snapshot by leg_id. Returns true on success, false/null on soft-fail.
export async function upsertFlightTrack(row) {
  const client = getClient();
  if (!client || !row?.leg_id) return null;
  try {
    const { error } = await client.from('flight_tracks').upsert(row, { onConflict: 'leg_id' });
    if (error) { console.warn('[flightTrackStore] upsert failed (soft):', error.message); return false; }
    return true;
  } catch (e) { console.warn('[flightTrackStore] upsert error (soft):', e?.message || e); return false; }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && node --test src/services/flightTrackStore.test.js`
Expected: PASS — all three soft-fail tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/flightTrackStore.js backend/src/services/flightTrackStore.test.js
git commit -m "Add soft-failing flightTrackStore (get/getStoredLegIds/upsert)"
```

---

## Task 4: Reconciler job + start with the server

**Files:**
- Create: `backend/src/services/flightTrackReconciler.js`
- Modify: `backend/src/index.js`

- [ ] **Step 1: Write the reconciler**

```js
// backend/src/services/flightTrackReconciler.js
// Periodic job that captures COMPLETED flights into the permanent flight_tracks
// table. Reuses the LevelFlight leg fetch + ADS-B clip logic from the
// previous-flights route. Idempotent: skips legs already stored. The one-time
// 90-day backfill is just runReconcile({ days: 90 }).

import * as lf from './levelflight.js';
import { queryTrack } from './adsbStore.js';
import { clipTrackToLeg, monthAnchors, selectCompletedLegs, selectLegsToSnapshot } from './adsbTrack.js';
import { getStoredLegIds, upsertFlightTrack } from './flightTrackStore.js';

const PAD_MS = 10 * 60 * 1000;          // match the previous-flights pad
const HOURLY_MS = 60 * 60 * 1000;
const RECONCILE_LOOKBACK_DAYS = 3;      // steady-state hourly window
let started = false;

// Capture completed flights from the last `days` into flight_tracks. Returns a
// small summary. Safe to re-run (idempotent via stored-id skip). Soft-fails as a
// whole — never throws.
export async function runReconcile({ days = RECONCILE_LOOKBACK_DAYS } = {}) {
  const now = Date.now();
  const windowStart = now - days * 86400000;
  let scanned = 0, written = 0, skipped = 0;
  try {
    const anchors = monthAnchors(windowStart, now);
    const results = await Promise.all(anchors.map((ts) => lf.getScheduledLegs(ts).catch(() => ({ legs: [] }))));
    const allLegs = results.flatMap((r) => r?.legs || []);
    const completed = selectCompletedLegs(allLegs, now).filter((l) => l.arrTime >= windowStart);
    scanned = completed.length;

    const existing = await getStoredLegIds(completed.map((l) => l.id));
    const todo = selectLegsToSnapshot(completed, existing);
    skipped = scanned - todo.length;

    // Group by tail so we query each aircraft's positions once.
    const byTail = new Map();
    for (const leg of todo) {
      if (!leg.tail) continue;
      if (!byTail.has(leg.tail)) byTail.set(leg.tail, []);
      byTail.get(leg.tail).push(leg);
    }
    for (const [tail, legs] of byTail.entries()) {
      const lo = Math.min(...legs.map((l) => l.depTime)) - PAD_MS;
      const hi = Math.max(...legs.map((l) => l.arrTime)) + PAD_MS;
      const positions = await queryTrack(tail, new Date(lo).toISOString(), new Date(hi).toISOString());
      for (const leg of legs) {
        const track = clipTrackToLeg(positions, leg, PAD_MS);
        const ok = await upsertFlightTrack({
          leg_id: leg.id,
          registration: tail,
          from_airport: leg.from,
          to_airport: leg.to,
          dep_time: new Date(leg.depTime).toISOString(),
          arr_time: new Date(leg.arrTime).toISOString(),
          track,
          point_count: track.length,
        });
        if (ok) written++;
      }
    }
  } catch (e) {
    console.warn('[flightTrackReconciler] runReconcile error (soft):', e?.message || e);
  }
  console.log(`[flightTrackReconciler] reconcile days=${days} scanned=${scanned} written=${written} skipped=${skipped}`);
  return { scanned, written, skipped };
}

export function startReconciler() {
  if (started) return;
  started = true;
  // One-time backfill on boot (idempotent), then a short-lookback hourly pass.
  runReconcile({ days: 90 }).catch(() => {});
  setInterval(() => { runReconcile({ days: RECONCILE_LOOKBACK_DAYS }).catch(() => {}); }, HOURLY_MS);
  console.log('[flightTrackReconciler] started (90d backfill on boot, hourly', RECONCILE_LOOKBACK_DAYS, 'day pass)');
}
```

- [ ] **Step 2: Verify it parses**

Run: `cd backend && node --check src/services/flightTrackReconciler.js`
Expected: no output (syntax OK).

- [ ] **Step 3: Start it with the server**

In `backend/src/index.js`, add the import after line 14 (`import { startRecorder } ...`):

```js
import { startReconciler } from './services/flightTrackReconciler.js';
```

Then in the `app.listen` callback (currently lines 59-62), add `startReconciler()` after `startRecorder()`:

```js
app.listen(PORT, () => {
  console.log(`Exjet backend listening on port ${PORT}`);
  startRecorder();
  startReconciler();
});
```

- [ ] **Step 4: Verify index parses**

Run: `cd backend && node --check src/index.js`
Expected: no output (syntax OK).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/flightTrackReconciler.js backend/src/index.js
git commit -m "Add flight-track reconciler; start it with the server"
```

---

## Task 5: `GET /api/adsb/flight-track/:legId` endpoint

**Files:**
- Modify: `backend/src/routes/adsb.js`

- [ ] **Step 1: Add the import**

Add to the top of `backend/src/routes/adsb.js` (after the existing imports):

```js
import { getFlightTrack } from '../services/flightTrackStore.js';
```

- [ ] **Step 2: Add the route (before `export default router;`)**

```js
// GET /api/adsb/flight-track/:legId?tail=N69FP&dep=<ms>&arr=<ms>
// Permanent snapshot for one completed flight. If none exists yet (in-progress /
// not-yet-reconciled), falls back to a live clip of raw positions when tail+dep
// are supplied. Soft: returns an empty track on any miss.
router.get('/flight-track/:legId', async (req, res) => {
  const legId = req.params.legId;
  try {
    const snap = await getFlightTrack(legId);
    if (snap) {
      return res.json({
        legId,
        source: 'snapshot',
        from: snap.from_airport,
        to: snap.to_airport,
        depTime: Date.parse(snap.dep_time) || null,
        arrTime: Date.parse(snap.arr_time) || null,
        track: snap.track || [],
      });
    }

    const tail = normReg(typeof req.query.tail === 'string' ? req.query.tail : '');
    const dep = parseInt(req.query.dep, 10);
    if (tail && Number.isFinite(dep)) {
      const now = Date.now();
      const arr = parseInt(req.query.arr, 10);
      const arrTime = Number.isFinite(arr) ? arr : now;
      const startIso = new Date(dep - PREV_PAD_MS).toISOString();
      const endIso = new Date(arrTime + PREV_PAD_MS).toISOString();
      const positions = await queryTrack(tail, startIso, endIso);
      const track = clipTrackToLeg(positions, { depTime: dep, arrTime }, PREV_PAD_MS);
      return res.json({ legId, source: 'live', from: null, to: null, depTime: dep, arrTime, track });
    }

    return res.json({ legId, source: 'none', track: [] });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'flight-track failed', track: [] });
  }
});
```

- [ ] **Step 3: Verify it parses**

Run: `cd backend && node --check src/routes/adsb.js`
Expected: no output (syntax OK).

- [ ] **Step 4: Manual smoke (optional, requires running backend + Supabase)**

Run the backend, then for a known completed `legId`:
`curl -s "$BASE/api/adsb/flight-track/<legId>" -H "Authorization: Bearer <token>" | jq '{source, points: (.track|length)}'`
Expected: `source: "snapshot"` (or `"live"`/`"none"`) with a point count.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/adsb.js
git commit -m "Add GET /api/adsb/flight-track/:legId (snapshot + live fallback)"
```

---

## Task 6: `useAdsb` — `fetchFlightTrack` helper

**Files:**
- Modify: `frontend/src/hooks/useAdsb.js`

- [ ] **Step 1: Add the helper (append to `useAdsb.js`)**

```js
// One-shot fetch of ONE flight's track. Returns the permanent snapshot if stored,
// else a live clip when tail/dep are provided. Shape:
// { legId, source: 'snapshot'|'live'|'none', track: [[lat,lon],...], from, to, depTime, arrTime }
export async function fetchFlightTrack(legId, { tail, dep, arr } = {}) {
  try {
    const qs = new URLSearchParams();
    if (tail) qs.set('tail', tail);
    if (dep) qs.set('dep', String(dep));
    if (arr) qs.set('arr', String(arr));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const r = await apiFetch(`/api/adsb/flight-track/${encodeURIComponent(legId)}${suffix}`);
    const j = await r.json();
    return j?.track ? j : { track: [], source: 'none' };
  } catch {
    return { track: [], source: 'none' };
  }
}
```

- [ ] **Step 2: Verify lint**

Run: `cd frontend && npx eslint src/hooks/useAdsb.js`
Expected: clean (no errors).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useAdsb.js
git commit -m "Add fetchFlightTrack helper to useAdsb"
```

---

## Task 7: `FlightTrackMap` component

**Files:**
- Create: `frontend/src/components/FlightTrackMap.jsx`

- [ ] **Step 1: Write the component**

```jsx
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Standalone Leaflet map for ONE flight's flown path. Draws the track polyline +
// departure/arrival markers and fits bounds. Always renders the map container
// (so it initializes once and survives the track arriving asynchronously); shows
// an overlay message when there is no track. Self-contained — no Map.jsx import.
export default function FlightTrackMap({ track = [], from, to, source }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);

  // Create the map once.
  useEffect(() => {
    if (mapRef.current || !elRef.current) return;
    const map = L.map(elRef.current, { center: [25, -40], zoom: 3, zoomControl: true });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CARTO', subdomains: 'abcd', maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 0); // settle size inside the layout
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Draw / redraw the track when it changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map._trackLayer) { map._trackLayer.remove(); map._trackLayer = null; }
    if (!track.length) return;
    const group = L.layerGroup();
    L.polyline(track, { color: '#38bdf8', weight: 3, opacity: 0.85 }).addTo(group);
    const start = track[0], end = track[track.length - 1];
    L.circleMarker(start, { radius: 6, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1 })
      .bindTooltip(from || 'Departure', { className: 'exjet-tooltip' }).addTo(group);
    L.circleMarker(end, { radius: 6, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1 })
      .bindTooltip(to || 'Arrival', { className: 'exjet-tooltip' }).addTo(group);
    group.addTo(map);
    map._trackLayer = group;
    map.fitBounds(L.latLngBounds(track), { padding: [40, 40] });
  }, [track, from, to]);

  return (
    <div style={{ position: 'relative', marginBottom: 20 }}>
      <div ref={elRef} style={{ height: 320, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }} />
      {!track.length && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: 14, pointerEvents: 'none' }}>
          No flight path recorded for this flight.
        </div>
      )}
      {source === 'live' && track.length > 0 && (
        <span style={{ position: 'absolute', top: 10, right: 10, zIndex: 500, fontSize: 11, padding: '3px 8px', borderRadius: 6, background: 'rgba(56,189,248,0.15)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.4)' }}>
          live
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify lint**

Run: `cd frontend && npx eslint src/components/FlightTrackMap.jsx`
Expected: clean (no errors).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/FlightTrackMap.jsx
git commit -m "Add FlightTrackMap component (single-flight Leaflet map)"
```

---

## Task 8: Render the map on the flight detail page

**Files:**
- Modify: `frontend/src/pages/FlightDetail.jsx`

- [ ] **Step 1: Add imports**

At the top of `frontend/src/pages/FlightDetail.jsx`, after the `AgentReviewPanel` import (line 4):

```js
import FlightTrackMap from '../components/FlightTrackMap';
import { fetchFlightTrack } from '../hooks/useAdsb';
```

- [ ] **Step 2: Add state + fetch effect (before the `if (!leg)` early return)**

Add a state hook alongside the others (near line 51, after `const [aiOpen, setAiOpen] = useState(false);`):

```js
const [flightTrack, setFlightTrack] = useState(null);
```

Add this effect after the existing ForeFlight `useEffect` (after line 73, still BEFORE the `if (!leg)` return so hook order is stable):

```js
const legId = leg?._id?.$oid;
useEffect(() => {
  if (!legId) return;
  let alive = true;
  (async () => {
    const res = await fetchFlightTrack(legId, {
      tail: leg?.dispatch?.aircraft?.tailNumber,
      dep: leg?.departure?.time,
      arr: leg?.arrival?.time,
    });
    if (alive) setFlightTrack(res);
  })();
  return () => { alive = false; };
}, [legId]);
```

- [ ] **Step 3: Render the map full-width below the header**

In the returned JSX, insert the map between the header `</div>` (currently line 131) and the two-column grid `<div style={{ display: 'grid', ... }}>` (currently line 133):

```jsx
      <FlightTrackMap
        track={flightTrack?.track || []}
        from={leg.departure?.airport}
        to={leg.arrival?.airport}
        source={flightTrack?.source}
      />

```

- [ ] **Step 4: Verify lint + build**

Run: `cd frontend && npx eslint src/pages/FlightDetail.jsx && npm run build 2>&1 | grep -E "built in|Error"`
Expected: eslint clean; `✓ built in ...`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/FlightDetail.jsx
git commit -m "Render FlightTrackMap on the flight detail page"
```

---

## Task 9: Full verification + backfill (before retention change)

- [ ] **Step 1: Backend tests + syntax**

Run: `cd backend && node --test src/services/adsbTrack.test.js src/services/flightTrackStore.test.js && for f in src/services/flightTrackReconciler.js src/services/flightTrackStore.js src/routes/adsb.js src/index.js; do node --check "$f"; done`
Expected: tests PASS; no syntax errors.

- [ ] **Step 2: Frontend lint + build**

Run: `cd frontend && npx eslint src/components/FlightTrackMap.jsx src/hooks/useAdsb.js src/pages/FlightDetail.jsx && npm run build 2>&1 | grep -E "built in|Error"`
Expected: eslint clean; build ok.

- [ ] **Step 3: Run the 90-day backfill (user-run; retention still 90 days)**

- Restart the backend; confirm both log lines:
  `[adsbRecorder] started ...` and `[flightTrackReconciler] started (90d backfill ...)`.
- Within a minute, confirm the reconcile summary line, e.g.
  `[flightTrackReconciler] reconcile days=90 scanned=N written=M skipped=K`.
- In Supabase, confirm rows landed: `select count(*) from flight_tracks;` returns > 0.
- Open a recently-completed flight's detail page: the map renders its path. Open an
  in-progress flight: the live track draws with a "live" badge. Open a flight with
  no ADS-B coverage: the "No flight path recorded" overlay shows.

> NOTE: Do NOT proceed to Task 10 until `flight_tracks` is confirmed populated. The
> retention reduction discards raw history older than 14 days, so the backfill must
> finish first.

---

## Task 10: Reduce raw-position retention 90 → 14 days (LAST)

**Files:**
- Modify: `backend/src/services/adsbRecorder.js`
- Modify: `backend/migrations/006_adsb_positions.sql` (comment only)

- [ ] **Step 1: Change retention**

In `backend/src/services/adsbRecorder.js`, change line 15:

```js
const RETENTION_DAYS = 90;
```
to:
```js
const RETENTION_DAYS = 14; // raw firehose only; permanent history lives in flight_tracks
```

- [ ] **Step 2: Update the migration comment**

In `backend/migrations/006_adsb_positions.sql`, change the comment line:

```sql
-- window (default 90 days) by the recorder. Soft-fails if Supabase is absent.
```
to:
```sql
-- window (default 14 days) by the recorder; permanent per-flight paths live in
-- flight_tracks. Soft-fails if Supabase is absent.
```

- [ ] **Step 3: Verify it parses**

Run: `cd backend && node --check src/services/adsbRecorder.js`
Expected: no output (syntax OK).

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/adsbRecorder.js backend/migrations/006_adsb_positions.sql
git commit -m "Reduce adsb_positions retention 90 -> 14 days (snapshots are now permanent)"
```

> NOTE: This task ships only AFTER Task 9's backfill is verified. Redeploy the
> backend so the new 14-day prune takes effect.

---

## Notes for the implementer

- **Supabase soft-fail:** with no Supabase, `flightTrackStore` returns null/empty, the
  reconciler writes nothing, and `/flight-track/:legId` returns an empty track — the
  flight page shows the "No flight path recorded" overlay and otherwise works.
- **Idempotency:** `runReconcile` skips legs already in `flight_tracks` (via
  `getStoredLegIds`), so the boot backfill is safe on every restart and the hourly
  pass never double-writes.
- **Live fallback needs router state:** `FlightDetail` gets its leg from router state,
  so a cold-loaded in-progress flight (no tail/times) can't draw the live track; the
  snapshot still loads by `legId`. Pre-existing `FlightDetail` limitation, acceptable.
- **No new test framework:** real logic lives in the pure helpers (Task 2) and the
  store soft-fail smoke (Task 3). The reconciler orchestration and React/Leaflet
  rendering are verified by `node --check` + `npm run build` + the manual map check.
- **Leaflet layer hygiene:** `FlightTrackMap` clears its single `_trackLayer` before
  redrawing, so the track never accumulates; the map instance is created once and
  removed on unmount.
