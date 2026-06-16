# Fleet Map Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revamp the fleet map to show live ADS-B flights with a takeoff-based "time flying" timer and a destination-airport icon, backed by an always-on server-side recorder that persists flight tracks so clicking an aircraft reveals its previous flights over a rolling few days.

**Architecture:** A background recorder (starts with the Express server, independent of clients) polls ADS-B every 15s and persists moved positions to a Supabase table, tracking each aircraft's takeoff time. A new per-aircraft endpoint reconstructs previous flights by clipping persisted tracks to completed LevelFlight legs. The React map (`Map.jsx`) renders live markers from real ADS-B position, a ticking timer, a destination marker+line, and on click draws that aircraft's historical tracks.

**Tech Stack:** Node/Express (ESM), Supabase (`@supabase/supabase-js`), `node:test`, React + Vite, Leaflet/react-leaflet.

---

## File Structure

**Backend**
- `backend/migrations/006_adsb_positions.sql` (new) — track-storage table.
- `backend/src/services/adsbTrack.js` (new) — PURE helpers: `hasMoved`, `detectTakeoff`, `clipTrackToLeg`. Unit-tested.
- `backend/src/services/adsbStore.js` (new) — soft-failing Supabase persistence: `savePositions`, `pruneOld`, `queryTrack`, `latestOnGroundBefore`. Mirrors `reviewStore.js` (returns null/empty when Supabase off).
- `backend/src/services/adsbRecorder.js` (new) — the always-on poller: interval, calls `getLivePositions()`, persists via `adsbStore`, maintains in-memory `airborneSince`, hourly prune. Exposes `startRecorder()` and `getAirborneSince()`.
- `backend/src/services/adsb.js` (modify) — no behavior change required; recorder imports its `getLivePositions`. (We deliberately do NOT couple recording into `getLivePositions`.)
- `backend/src/routes/adsb.js` (modify) — add `airborneSinceMs` to `/positions`; add `GET /previous-flights`.
- `backend/src/index.js` (modify) — call `startRecorder()` after `app.listen`.

**Frontend**
- `frontend/src/lib/formatElapsed.js` (new) — PURE `formatElapsed(ms)`. Unit-tested with `node:test`.
- `frontend/src/components/FlyingTimer.jsx` (new) — ticking timer using `formatElapsed`.
- `frontend/src/hooks/useAdsb.js` (modify) — surface `airborneSinceMs` (already returns `positions`); add `fetchPreviousFlights(tail, days)`.
- `frontend/src/pages/Map.jsx` (modify) — live markers from ADS-B, timer, destination icon+line, click-to-show previous flights.

---

## Task 1: Migration — `adsb_positions` table

**Files:**
- Create: `backend/migrations/006_adsb_positions.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 006_adsb_positions.sql
-- Persisted ADS-B position history for the fleet map. Written by the always-on
-- recorder (src/services/adsbRecorder.js) every ~15s, independent of any client.
-- Used to reconstruct previous flights' real flown paths. Pruned to a rolling
-- window (default 7 days) by the recorder. Soft-fails if Supabase is absent.

create table if not exists public.adsb_positions (
    id           bigint generated always as identity primary key,
    registration text             not null,
    lat          double precision not null,
    lon          double precision not null,
    altitude_ft  integer,
    on_ground    boolean          not null default false,
    t            timestamptz      not null
);

create index if not exists adsb_positions_reg_t_idx
    on public.adsb_positions (registration, t);
```

- [ ] **Step 2: Commit**

```bash
git add backend/migrations/006_adsb_positions.sql
git commit -m "Add adsb_positions migration for flight track persistence"
```

> NOTE: This migration must be applied in the Supabase SQL editor before the
> recorder can persist (it soft-fails until then). Flag to the user at the end.

---

## Task 2: Pure track helpers + tests

**Files:**
- Create: `backend/src/services/adsbTrack.js`
- Test: `backend/src/services/adsbTrack.test.js`

- [ ] **Step 1: Write the failing test**

```js
// backend/src/services/adsbTrack.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasMoved, detectTakeoff, clipTrackToLeg } from './adsbTrack.js';

test('hasMoved is false within threshold, true beyond it', () => {
  const a = { lat: 26.0, lon: -80.0 };
  assert.equal(hasMoved(a, { lat: 26.0001, lon: -80.0001 }, 0.01), false);
  assert.equal(hasMoved(a, { lat: 26.2, lon: -80.0 }, 0.01), true);
  assert.equal(hasMoved(null, a, 0.01), true); // no previous -> always record first
});

test('detectTakeoff sets airborneSince on ground->air, clears on landing, carries otherwise', () => {
  // ground -> airborne => takeoff at now
  assert.equal(detectTakeoff({ onGround: true, airborneSince: null }, { onGround: false, t: 1000 }), 1000);
  // airborne -> airborne => carry existing
  assert.equal(detectTakeoff({ onGround: false, airborneSince: 1000 }, { onGround: false, t: 2000 }), 1000);
  // anything -> on ground => null (landed)
  assert.equal(detectTakeoff({ onGround: false, airborneSince: 1000 }, { onGround: true, t: 3000 }), null);
  // no prior + airborne => unknown (null; timer stays hidden until a real takeoff)
  assert.equal(detectTakeoff(null, { onGround: false, t: 4000 }), null);
});

test('clipTrackToLeg keeps positions within the padded leg window, ordered by time', () => {
  const positions = [
    { lat: 1, lon: 1, t: 100 },
    { lat: 2, lon: 2, t: 200 },
    { lat: 3, lon: 3, t: 300 },
    { lat: 4, lon: 4, t: 400 },
  ];
  const leg = { depTime: 150, arrTime: 350 };
  // pad 0 -> only 200 and 300
  assert.deepEqual(clipTrackToLeg(positions, leg, 0), [[2, 2], [3, 3]]);
  // pad 60 -> includes 100..400 boundary expands
  assert.deepEqual(clipTrackToLeg(positions, leg, 60), [[1, 1], [2, 2], [3, 3], [4, 4]]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node --test src/services/adsbTrack.test.js`
Expected: FAIL — `Cannot find module './adsbTrack.js'`.

- [ ] **Step 3: Implement the helpers**

```js
// backend/src/services/adsbTrack.js
// Pure helpers for ADS-B track recording and previous-flight reconstruction.
// No I/O — unit-tested in adsbTrack.test.js.

// True if `next` differs from `prev` by more than `thresholdDeg` in lat+lon
// (Manhattan in degrees, matching the existing trail dedup). No prev => true.
export function hasMoved(prev, next, thresholdDeg) {
  if (!prev) return true;
  return Math.abs(next.lat - prev.lat) + Math.abs(next.lon - prev.lon) >= thresholdDeg;
}

// Given the previous sample ({ onGround, airborneSince }) and the next
// observation ({ onGround, t }), return the new airborneSince (epoch ms or null).
//   ground -> airborne : takeoff, returns next.t
//   on ground          : returns null (parked/landed)
//   airborne -> airborne: carries the prior airborneSince
//   no prev + airborne : null (unknown; timer hidden until a real takeoff)
export function detectTakeoff(prev, next) {
  if (next.onGround) return null;
  if (!prev) return null;
  if (prev.onGround) return next.t;
  return prev.airborneSince ?? null;
}

// Clip a time-ordered position list to a leg's [depTime - pad, arrTime + pad]
// window and return [[lat, lon], ...] for a Leaflet polyline.
export function clipTrackToLeg(positions, leg, padMs) {
  const lo = leg.depTime - padMs;
  const hi = leg.arrTime + padMs;
  return positions
    .filter((p) => p.t >= lo && p.t <= hi)
    .sort((a, b) => a.t - b.t)
    .map((p) => [p.lat, p.lon]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test src/services/adsbTrack.test.js`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/adsbTrack.js backend/src/services/adsbTrack.test.js
git commit -m "Add pure ADS-B track helpers (hasMoved, detectTakeoff, clipTrackToLeg)"
```

---

## Task 3: Soft-failing persistence store (`adsbStore.js`)

**Files:**
- Create: `backend/src/services/adsbStore.js`

This mirrors `backend/src/agent/reviewStore.js`: a module-level lazy client that
returns `null` (and the functions no-op / return empty) when Supabase env is
absent, so the server never crashes without Supabase.

- [ ] **Step 1: Implement the store**

```js
// backend/src/services/adsbStore.js
// Soft-failing persistence for ADS-B position history. If Supabase isn't
// configured, every function no-ops (returns null/[]/0) so the recorder and
// endpoints keep working without it. Same pattern as agent/reviewStore.js.

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

let _client = null;
function getClient() {
  if (_client !== null) return _client || null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) { _client = false; return null; }
  try { _client = createClient(url, key); return _client; }
  catch (e) { console.warn('[adsbStore] client init failed (soft):', e.message); _client = false; return null; }
}

// rows: [{ registration, lat, lon, altitude_ft, on_ground, t (ISO string) }]
export async function savePositions(rows) {
  if (!rows.length) return 0;
  const client = getClient();
  if (!client) return 0;
  try {
    const { error } = await client.from('adsb_positions').insert(rows);
    if (error) { console.warn('[adsbStore] insert failed (soft):', error.message); return 0; }
    return rows.length;
  } catch (e) { console.warn('[adsbStore] insert error (soft):', e?.message || e); return 0; }
}

// Delete rows older than `cutoffIso`. Returns true on success (best-effort).
export async function pruneOld(cutoffIso) {
  const client = getClient();
  if (!client) return false;
  try {
    const { error } = await client.from('adsb_positions').delete().lt('t', cutoffIso);
    if (error) { console.warn('[adsbStore] prune failed (soft):', error.message); return false; }
    return true;
  } catch (e) { console.warn('[adsbStore] prune error (soft):', e?.message || e); return false; }
}

// All positions for one registration in [startIso, endIso], oldest first.
// Returns [{ lat, lon, t (epoch ms), on_ground }].
export async function queryTrack(registration, startIso, endIso) {
  const client = getClient();
  if (!client) return [];
  try {
    const { data, error } = await client
      .from('adsb_positions')
      .select('lat, lon, t, on_ground')
      .eq('registration', registration)
      .gte('t', startIso).lte('t', endIso)
      .order('t', { ascending: true });
    if (error) { console.warn('[adsbStore] queryTrack failed (soft):', error.message); return []; }
    return (data || []).map((r) => ({ lat: r.lat, lon: r.lon, t: Date.parse(r.t), on_ground: r.on_ground }));
  } catch (e) { console.warn('[adsbStore] queryTrack error (soft):', e?.message || e); return []; }
}
```

> NOTE on restart behavior: if the server restarts while an aircraft is already
> airborne, we do NOT guess its takeoff time — the timer stays hidden (null)
> until we observe a real on-ground→airborne transition. This is intentional
> (honest over misleading) and is handled entirely by `detectTakeoff` returning
> null for the "no prev + airborne" case.

- [ ] **Step 2: Syntax check**

Run: `cd backend && node --check src/services/adsbStore.js`
Expected: no output (ok).

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/adsbStore.js
git commit -m "Add soft-failing adsbStore (persist/prune/query ADS-B positions)"
```

---

## Task 4: Always-on recorder (`adsbRecorder.js`) + start in server

**Files:**
- Create: `backend/src/services/adsbRecorder.js`
- Modify: `backend/src/index.js` (add `startRecorder()` after `app.listen`)

- [ ] **Step 1: Implement the recorder**

```js
// backend/src/services/adsbRecorder.js
// Always-on background poller. Starts with the server and records fleet ADS-B
// positions every RECORD_INTERVAL_MS regardless of whether any client is
// connected, so flight tracks accumulate continuously. Maintains in-memory
// airborneSince per aircraft for the "time flying" timer, and prunes old rows.

import { getLivePositions } from './adsb.js';
import { savePositions, pruneOld } from './adsbStore.js';
import { hasMoved, detectTakeoff } from './adsbTrack.js';

const RECORD_INTERVAL_MS = 15000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000; // hourly
const RETENTION_DAYS = 7;
const MOVE_THRESHOLD_DEG = 0.0005;

// reg -> { lat, lon, onGround, airborneSince }
const last = new Map();
let started = false;

export function getAirborneSince() {
  const out = {};
  for (const [reg, s] of last.entries()) out[reg] = s.airborneSince ?? null;
  return out;
}

async function tick() {
  let positions;
  try { positions = await getLivePositions(); }
  catch (e) { console.warn('[adsbRecorder] positions fetch failed:', e?.message || e); return; }

  const now = Date.now();
  const rows = [];
  for (const [reg, p] of Object.entries(positions || {})) {
    if (p?.lat == null || p?.lon == null) continue;
    const prev = last.get(reg) || null;
    const onGround = !!p.onGround;

    // Takeoff time from the ground->air transition. If we boot mid-flight (no
    // prev) and it's airborne, detectTakeoff returns null and the timer stays
    // hidden until we observe a real takeoff — honest over guessing.
    const airborneSince = detectTakeoff(
      prev ? { onGround: prev.onGround, airborneSince: prev.airborneSince } : null,
      { onGround, t: now },
    );

    if (hasMoved(prev, { lat: p.lat, lon: p.lon }, MOVE_THRESHOLD_DEG)) {
      rows.push({
        registration: reg, lat: p.lat, lon: p.lon,
        altitude_ft: Number.isFinite(p.altitudeFt) ? p.altitudeFt : null,
        on_ground: onGround, t: new Date(now).toISOString(),
      });
    }
    last.set(reg, { lat: p.lat, lon: p.lon, onGround, airborneSince });
  }
  if (rows.length) await savePositions(rows);
}

async function prune() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString();
  await pruneOld(cutoff);
}

export function startRecorder() {
  if (started) return;
  started = true;
  tick().catch(() => {});
  setInterval(() => { tick().catch(() => {}); }, RECORD_INTERVAL_MS);
  prune().catch(() => {});
  setInterval(() => { prune().catch(() => {}); }, PRUNE_INTERVAL_MS);
  console.log('[adsbRecorder] started (interval', RECORD_INTERVAL_MS, 'ms, retention', RETENTION_DAYS, 'days)');
}
```

- [ ] **Step 2: Wire it into the server**

In `backend/src/index.js`, find the `app.listen(...)` call (the line that logs
"Exjet backend listening on port"). Add the import at the top with the other
imports and call `startRecorder()` inside the listen callback. Concretely:

```js
// near the other imports at the top of src/index.js
import { startRecorder } from './services/adsbRecorder.js';
```

```js
// replace the existing listen line:
//   app.listen(PORT, () => console.log(`Exjet backend listening on port ${PORT}`));
// with:
app.listen(PORT, () => {
  console.log(`Exjet backend listening on port ${PORT}`);
  startRecorder();
});
```

- [ ] **Step 3: Syntax check both files**

Run: `cd backend && node --check src/services/adsbRecorder.js && node --check src/index.js`
Expected: no output (ok).

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/adsbRecorder.js backend/src/index.js
git commit -m "Add always-on ADS-B recorder; start it with the server"
```

---

## Task 5: Expose `airborneSinceMs` on `/api/adsb/positions`

**Files:**
- Modify: `backend/src/routes/adsb.js`

- [ ] **Step 1: Update the positions route**

In `backend/src/routes/adsb.js`, import the recorder accessor and merge
`airborneSinceMs` into each position. Replace the existing `/positions` handler:

```js
// existing handler:
// router.get('/positions', async (req, res) => {
//   try { res.json({ positions: await getLivePositions() }); }
//   catch (e) { res.status(502).json({ error: e.message, positions: {} }); }
// });
```

with (add `import { getAirborneSince } from '../services/adsbRecorder.js';` at
the top of the file alongside the existing imports):

```js
router.get('/positions', async (req, res) => {
  try {
    const positions = await getLivePositions();
    const airborne = getAirborneSince();
    const merged = {};
    for (const [reg, p] of Object.entries(positions)) {
      merged[reg] = { ...p, airborneSinceMs: airborne[reg] ?? null };
    }
    res.json({ positions: merged });
  } catch (e) {
    res.status(502).json({ error: e.message, positions: {} });
  }
});
```

- [ ] **Step 2: Syntax check**

Run: `cd backend && node --check src/routes/adsb.js`
Expected: no output (ok).

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/adsb.js
git commit -m "Expose airborneSinceMs on /api/adsb/positions"
```

---

## Task 6: `GET /api/adsb/previous-flights` endpoint

**Files:**
- Modify: `backend/src/routes/adsb.js`

Reuses the LevelFlight service the `/legs` route uses. Check how `src/routes/levelflight.js`
imports it (`import * as lf from '../services/levelflight.js'` and calls
`lf.getScheduledLegs(ts)` / `getMonthTimestamps`). Mirror that.

- [ ] **Step 1: Add the route**

At the top of `backend/src/routes/adsb.js`, add imports:

```js
import * as lf from '../services/levelflight.js';
import { queryTrack } from '../services/adsbStore.js';
import { clipTrackToLeg } from '../services/adsbTrack.js';
```

Then add the handler (before `export default router;`):

```js
const PREV_PAD_MS = 10 * 60 * 1000; // 10-minute pad around each leg window

// GET /api/adsb/previous-flights?tail=N69FP&days=3
// Completed legs for `tail` in the last `days`, each with its real ADS-B track
// (persisted positions clipped to the leg window). Soft: returns [] on any miss.
router.get('/previous-flights', async (req, res) => {
  const tail = typeof req.query.tail === 'string' ? req.query.tail.trim().toUpperCase() : '';
  const days = Math.max(1, Math.min(14, parseInt(req.query.days || '3', 10) || 3));
  if (!tail) return res.status(400).json({ error: 'tail is required', flights: [] });

  const now = Date.now();
  const windowStart = now - days * 86400000;

  try {
    // Pull legs across the window (month-anchored, same as /legs).
    const anchors = monthAnchors(windowStart, now);
    const results = await Promise.all(anchors.map((ts) => lf.getScheduledLegs(ts).catch(() => ({ legs: [] }))));
    const seen = new Set();
    const legs = [];
    for (const r of results) for (const l of (r?.legs || [])) {
      const id = l._id?.$oid; if (!id || seen.has(id)) continue; seen.add(id);
      const dep = l.departure?.time, arr = l.arrival?.time;
      if (!dep || !arr) continue;
      if ((l.departure?.airport || '') && eqTail(l, tail) && arr <= now && arr >= windowStart) {
        legs.push({ id, from: l.departure.airport, to: l.arrival.airport, depTime: dep, arrTime: arr });
      }
    }

    const startIso = new Date(windowStart - PREV_PAD_MS).toISOString();
    const endIso = new Date(now + PREV_PAD_MS).toISOString();
    const positions = await queryTrack(tail, startIso, endIso);

    const flights = legs
      .sort((a, b) => b.depTime - a.depTime)
      .map((leg) => ({
        legId: leg.id, from: leg.from, to: leg.to, depTime: leg.depTime, arrTime: leg.arrTime,
        track: clipTrackToLeg(positions, leg, PREV_PAD_MS),
      }));

    res.json({ tail, days, flights });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'previous-flights failed', flights: [] });
  }
});

// Local helpers (kept here; small and route-specific).
function eqTail(leg, tail) {
  const t = leg.dispatch?.aircraft?.tailNumber || leg.aircraft?.tailNumber || '';
  return String(t).trim().toUpperCase() === tail;
}
function monthAnchors(startMs, endMs) {
  const out = []; const d = new Date(startMs);
  let y = d.getUTCFullYear(), m = d.getUTCMonth();
  for (;;) { const t = Date.UTC(y, m, 1); if (t > endMs) break; out.push(t); m++; if (m > 11) { m = 0; y++; } if (out.length > 24) break; }
  out.unshift(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  return out;
}
```

> NOTE: Verify the tail field path on a leg (`dispatch.aircraft.tailNumber`) by
> checking `src/routes/levelflight.js` / a sample leg; adjust `eqTail` if the
> field differs. The `_calc.from/to` exists but tail is on `dispatch.aircraft`.

- [ ] **Step 2: Syntax check**

Run: `cd backend && node --check src/routes/adsb.js`
Expected: no output (ok).

- [ ] **Step 3: Manual smoke (server running, logged in)**

Run: `curl -s "http://localhost:3001/api/adsb/previous-flights?tail=N69FP&days=3"`
Expected: `401` (auth-gated) or JSON `{ tail, days, flights: [...] }` — either
confirms the route is mounted (not 404).

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/adsb.js
git commit -m "Add /api/adsb/previous-flights (per-aircraft tracks by leg)"
```

---

## Task 7: Frontend `formatElapsed` helper + test

**Files:**
- Create: `frontend/src/lib/formatElapsed.js`
- Test: `frontend/src/lib/formatElapsed.test.js`

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/lib/formatElapsed.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatElapsed } from './formatElapsed.js';

test('formatElapsed: under an hour shows M:SS', () => {
  assert.equal(formatElapsed(0), '0:00');
  assert.equal(formatElapsed(65 * 1000), '1:05');
  assert.equal(formatElapsed(59 * 60 * 1000 + 59 * 1000), '59:59');
});

test('formatElapsed: an hour or more shows H:MM', () => {
  assert.equal(formatElapsed(60 * 60 * 1000), '1:00');
  assert.equal(formatElapsed(2 * 60 * 60 * 1000 + 27 * 60 * 1000), '2:27');
});

test('formatElapsed: null/negative -> dash', () => {
  assert.equal(formatElapsed(null), '—');
  assert.equal(formatElapsed(-5), '—');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && node --test src/lib/formatElapsed.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// frontend/src/lib/formatElapsed.js
// Format an elapsed duration (ms). Under an hour -> "M:SS"; an hour or more ->
// "H:MM". null/negative -> "—". Used by the in-flight timer.
export function formatElapsed(ms) {
  if (ms == null || ms < 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h >= 1) return `${h}:${String(m).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/lib/formatElapsed.test.js`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/formatElapsed.js frontend/src/lib/formatElapsed.test.js
git commit -m "Add formatElapsed helper for the in-flight timer"
```

---

## Task 8: `FlyingTimer` component

**Files:**
- Create: `frontend/src/components/FlyingTimer.jsx`

- [ ] **Step 1: Implement**

```jsx
// frontend/src/components/FlyingTimer.jsx
// Live-ticking "time flying" label. Counts from `sinceMs` (epoch ms of takeoff).
// Renders nothing if sinceMs is null (unknown takeoff -> no guess).
import { useEffect, useState } from 'react';
import { formatElapsed } from '../lib/formatElapsed';

export default function FlyingTimer({ sinceMs, style }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (sinceMs == null) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [sinceMs]);
  if (sinceMs == null) return null;
  return <span style={style}>{formatElapsed(Date.now() - sinceMs)} airborne</span>;
}
```

- [ ] **Step 2: Lint**

Run: `cd frontend && npx eslint src/components/FlyingTimer.jsx`
Expected: clean (exit 0).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/FlyingTimer.jsx
git commit -m "Add FlyingTimer component"
```

---

## Task 9: `useAdsb` — previous-flights fetch helper

**Files:**
- Modify: `frontend/src/hooks/useAdsb.js`

`positions` already flows through and now carries `airborneSinceMs` per
aircraft (Task 5), so no change is needed for the timer data. Add a fetch helper
for previous flights.

- [ ] **Step 1: Add the helper export**

At the bottom of `frontend/src/hooks/useAdsb.js`, add a standalone exported
function (it does a one-shot fetch; no hook needed):

```js
// One-shot fetch of a single aircraft's previous flights (rolling `days`).
// Returns { tail, days, flights: [{ legId, from, to, depTime, arrTime, track }] }
// or { flights: [] } on failure.
export async function fetchPreviousFlights(tail, days = 3) {
  try {
    const r = await apiFetch(`/api/adsb/previous-flights?tail=${encodeURIComponent(tail)}&days=${days}`);
    const j = await r.json();
    return j?.flights ? j : { flights: [] };
  } catch {
    return { flights: [] };
  }
}
```

(`apiFetch` is already imported at the top of the file.)

- [ ] **Step 2: Lint**

Run: `cd frontend && npx eslint src/hooks/useAdsb.js`
Expected: clean (exit 0).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useAdsb.js
git commit -m "Add fetchPreviousFlights helper to useAdsb"
```

---

## Task 10: Map — live markers from ADS-B + heading rotation

**Files:**
- Modify: `frontend/src/pages/Map.jsx`

Read the current file first to understand its Leaflet setup (it uses raw `L`
markers via `divIcon`, a `useApi('/api/levelflight/legs')` for legs, and
`useAdsb` for positions). The change: make the live marker position/heading come
from ADS-B `positions[tail]` when present, falling back to the existing
schedule-interpolated position only when ADS-B has no fix.

- [ ] **Step 1: Use ADS-B position as primary**

In the marker-building code (where `getAircraftPositions(legs)` results are
turned into markers), for each aircraft `ac` with tail `ac.tail`, prefer the
live ADS-B fix:

```jsx
// `positions` comes from useAdsb(); shape: { [tail]: { lat, lon, track, onGround, airborneSinceMs, ... } }
const live = positions[ac.tail];
const markerLat = live?.lat ?? ac.position.lat;
const markerLng = live?.lon ?? ac.position.lng;
const heading = live?.track ?? 0;
const isAirborne = live ? !live.onGround : (ac.statusLabel === 'In Flight');
```

Apply `markerLat/markerLng` to the marker's `L.marker([markerLat, markerLng], ...)`
and rotate the icon with the heading. If the existing `divIcon` uses an `<img>`
or glyph, add an inline `transform: rotate(${heading}deg)` to its `html`. Keep
the existing on-ground vs in-flight color styling, driven by `isAirborne`.

- [ ] **Step 2: Verify build**

Run: `cd frontend && npm run build 2>&1 | grep -E "built in|Error"`
Expected: `✓ built in ...` (no Error).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Map.jsx
git commit -m "Map: drive live aircraft markers from real ADS-B position + heading"
```

---

## Task 11: Map — flying timer + destination icon + line

**Files:**
- Modify: `frontend/src/pages/Map.jsx`

- [ ] **Step 1: Add the timer to the marker popup/label**

Import the timer at the top: `import FlyingTimer from '../components/FlyingTimer';`
For airborne aircraft, render `<FlyingTimer sinceMs={live?.airborneSinceMs} />`
inside the marker's popup/tooltip content (wherever the aircraft label is built).
Because the map uses raw Leaflet, the popup HTML is a string; instead bind the
timer where the page renders React popups. If the popup is a raw Leaflet string,
add a small React-rendered overlay panel for the selected aircraft (see Task 12's
selection state) and place `<FlyingTimer>` there. Minimum requirement: the timer
shows for the selected/airborne aircraft and ticks every second.

- [ ] **Step 2: Draw the destination marker + line**

For an airborne aircraft, resolve its active leg (the leg where
`departure.time <= now <= arrival.time` for that tail — already computed in
`getAircraftPositions`; expose `activeLeg` on the returned `ac` object). Then:

```jsx
// destination airport coordinates from the active leg
const destLoc = ac.activeLeg?._calc?.to?.location; // { lat, lng }
if (isAirborne && destLoc) {
  // destination airport marker
  L.marker([destLoc.lat, destLoc.lng], { icon: destinationIcon })
    .addTo(map).bindTooltip(`Dest ${ac.activeLeg.arrival.airport}`);
  // faint line aircraft -> destination
  L.polyline([[markerLat, markerLng], [destLoc.lat, destLoc.lng]],
    { color: '#94a3b8', weight: 1.5, opacity: 0.5, dashArray: '4 6' }).addTo(map);
}
```

Define `destinationIcon` once with `L.divIcon` (a small airport glyph, e.g. a
filled circle/pin distinct from the aircraft icon). Ensure these overlays are
added to the same layer group you clear/redraw on each update (so they don't
accumulate). If the current code redraws markers into a `LayerGroup`/`featureGroup`,
add the destination marker and line to that same group.

- [ ] **Step 3: Verify build**

Run: `cd frontend && npm run build 2>&1 | grep -E "built in|Error"`
Expected: `✓ built in ...`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Map.jsx
git commit -m "Map: in-flight timer + destination airport icon and line"
```

---

## Task 12: Map — click aircraft to show its previous flights

**Files:**
- Modify: `frontend/src/pages/Map.jsx`

- [ ] **Step 1: Add selection state + day window**

Near the other `useState` in the `Map` component:

```jsx
const [selectedTail, setSelectedTail] = useState(null);
const [prevDays, setPrevDays] = useState(3);
const [prevFlights, setPrevFlights] = useState([]); // [{ track:[[lat,lon]...], from, to, depTime }]
const prevLayerRef = useRef(null); // L.LayerGroup for historical tracks
```

Import the fetch helper: `import { fetchPreviousFlights } from '../hooks/useAdsb';`

- [ ] **Step 2: Wire the marker click**

When building each aircraft marker, attach a click handler that toggles
selection:

```jsx
marker.on('click', () => {
  setSelectedTail((cur) => (cur === ac.tail ? null : ac.tail));
});
```

- [ ] **Step 3: Fetch + draw on selection change**

```jsx
useEffect(() => {
  const map = mapRef.current; if (!map) return;
  // clear previous historical layer
  if (prevLayerRef.current) { prevLayerRef.current.remove(); prevLayerRef.current = null; }
  setPrevFlights([]);
  if (!selectedTail) return;
  let alive = true;
  (async () => {
    const { flights } = await fetchPreviousFlights(selectedTail, prevDays);
    if (!alive) return;
    setPrevFlights(flights);
    const group = L.layerGroup();
    for (const f of flights) {
      if (!f.track?.length) continue;
      L.polyline(f.track, { color: '#38bdf8', weight: 2, opacity: 0.45 })
        .bindTooltip(`${f.from} → ${f.to}`).addTo(group);
    }
    group.addTo(map);
    prevLayerRef.current = group;
  })();
  return () => { alive = false; };
}, [selectedTail, prevDays]);
```

(Use the existing map instance ref — confirm its name when reading the file;
the plan assumes `mapRef.current`. If the file stores the map differently, use
that.)

- [ ] **Step 4: Add a small control for the selected aircraft**

Render (in the page JSX, outside the Leaflet container) a small panel when
`selectedTail` is set: shows the tail, a day-window selector
(`<select value={prevDays} onChange={e => setPrevDays(+e.target.value)}>` with
1/3/7), the count of flights drawn, and a "Clear" button
(`onClick={() => setSelectedTail(null)}`). Note when `prevFlights` is non-empty
but all tracks are empty (older than retention): "No recorded tracks in range."

- [ ] **Step 5: Verify build + lint**

Run: `cd frontend && npm run build 2>&1 | grep -E "built in|Error" && npx eslint src/pages/Map.jsx`
Expected: `✓ built in ...` and eslint clean (exit 0).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Map.jsx
git commit -m "Map: click aircraft to toggle its previous flights (per-aircraft, rolling days)"
```

---

## Task 13: Full verification + migration note

- [ ] **Step 1: Backend tests + syntax**

Run: `cd backend && node --test src/services/adsbTrack.test.js && for f in src/services/adsbStore.js src/services/adsbRecorder.js src/routes/adsb.js src/index.js; do node --check "$f"; done`
Expected: tests PASS; no syntax errors.

- [ ] **Step 2: Frontend tests + build + lint**

Run: `cd frontend && node --test src/lib/formatElapsed.test.js && npm run build 2>&1 | grep -E "built in|Error" && npx eslint src/pages/Map.jsx src/components/FlyingTimer.jsx src/hooks/useAdsb.js src/lib/formatElapsed.js`
Expected: tests PASS; build ok; eslint clean.

- [ ] **Step 3: Apply migration + live check (user-run)**

- Apply `backend/migrations/006_adsb_positions.sql` in Supabase.
- Restart the backend; confirm the log line `[adsbRecorder] started ...`.
- With the backend running a few minutes, confirm rows appear:
  `select count(*) from adsb_positions;` returns > 0 even with no client open.
- Open the map: live markers move, airborne aircraft show a ticking timer and a
  destination icon+line; clicking an aircraft draws its previous flights.

- [ ] **Step 4: Final commit (if any cleanup)**

```bash
git add -A && git commit -m "Fleet map revamp: final verification"
```

---

## Notes for the implementer

- **Supabase soft-fail**: everything degrades gracefully without Supabase — the
  server still boots, live positions still work, previous-flights returns `[]`.
- **Leaflet layer hygiene**: the map already redraws markers on each ADS-B
  update; add destination markers/lines to the SAME layer group that gets
  cleared each cycle, or they accumulate. Previous-flight tracks live in their
  own `prevLayerRef` group, cleared on selection change only.
- **Tail field on legs**: confirm `dispatch.aircraft.tailNumber` against a real
  leg before trusting `eqTail`.
- **No frontend test harness** beyond `node:test` for pure helpers; React/Leaflet
  behavior is verified via `npm run build` + manual map check.
