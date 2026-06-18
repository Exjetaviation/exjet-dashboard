# Scheduling Read UI — Trips/Legs List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new "Scheduling" section to the dashboard whose Trips/Legs list reads the **mirror** (`scheduling_legs`) instead of a live LevelFlight call — reusing the existing list components unchanged, in the dashboard's look.

**Architecture:** First read-UI deliverable of Slice 1 (spec: `docs/superpowers/specs/2026-06-18-scheduling-dispatcher-web-design.md`). Each `scheduling_legs` row stores the full LevelFlight leg object in `lf_synced_snapshot` — exactly the shape the existing `FlightsList`/`TripsList`/`FlightsFilterBar` components already consume. So the work is tiny: a backend endpoint that returns those snapshots (tagged with mirror provenance), and a `Scheduling` page that is a near-clone of `Flights.jsx` pointed at the new endpoint, plus a route and a sidebar link. This intentionally looks like today's Flights page but is sourced from the new independent store — the foundation that will diverge as native-created trips and editing arrive. The Schedule board (calendar) is a later slice (`Calendar.jsx` is tightly coupled to several live endpoints).

**Tech Stack:** Backend: Node/Express, Supabase. Frontend: React 19 + Vite, React Router 7, inline styles with CSS variables (no Tailwind). Backend tests via `node:test`; frontend verified by `npm run build`.

**Note on status codes:** mirrored trip/leg `status` is a LevelFlight numeric enum (observed `0`, `2`, `4`). The existing `FlightsList` already maps common codes to labels; an unmapped code (e.g. `4`) renders via its existing fallback. Refining the full code→label map is deferred to a later UI-polish step and does not block this slice.

---

## File Structure

- `backend/src/scheduling/mirrorLegs.js` — **new.** Pure: shape `scheduling_legs` rows into the leg-object array the list components expect.
- `backend/src/scheduling/mirrorLegs.test.js` — **new.** Unit tests.
- `backend/src/routes/scheduling.js` — **modify.** Add `GET /legs`.
- `frontend/src/pages/Scheduling.jsx` — **new.** The Scheduling page (clone of `Flights.jsx`, mirror endpoint).
- `frontend/src/App.jsx` — **modify.** Add the `/scheduling` route.
- `frontend/src/components/Sidebar.jsx` — **modify.** Add the "Scheduling" nav link.

---

### Task 1: Backend — mirror legs helper + endpoint

**Files:**
- Create: `backend/src/scheduling/mirrorLegs.test.js`
- Create: `backend/src/scheduling/mirrorLegs.js`
- Modify: `backend/src/routes/scheduling.js`

- [ ] **Step 1: Write the failing test.** Create `backend/src/scheduling/mirrorLegs.test.js`:

```js
// backend/src/scheduling/mirrorLegs.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mirrorLegsFromRows } from './mirrorLegs.js';

test('mirrorLegsFromRows returns snapshots tagged with mirror provenance', () => {
  const rows = [
    {
      lf_synced_snapshot: { departure: { airport: 'KFXE' }, status: 2, dispatch: { tripId: 25104 } },
      origin: 'levelflight', locally_modified: false, upstream_changed: false,
    },
  ];
  const legs = mirrorLegsFromRows(rows);
  assert.equal(legs.length, 1);
  assert.equal(legs[0].departure.airport, 'KFXE');
  assert.equal(legs[0].status, 2);
  assert.equal(legs[0].dispatch.tripId, 25104);
  assert.deepEqual(legs[0]._mirror, { origin: 'levelflight', locally_modified: false, upstream_changed: false });
});

test('mirrorLegsFromRows drops rows without a snapshot and handles nullish input', () => {
  assert.deepEqual(mirrorLegsFromRows([{ lf_synced_snapshot: null, origin: 'native' }]), []);
  assert.deepEqual(mirrorLegsFromRows([]), []);
  assert.deepEqual(mirrorLegsFromRows(null), []);
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `node --test backend/src/scheduling/mirrorLegs.test.js` — Expected: FAIL, cannot find module `./mirrorLegs.js`.

- [ ] **Step 3: Write the implementation.** Create `backend/src/scheduling/mirrorLegs.js`:

```js
// backend/src/scheduling/mirrorLegs.js
//
// Pure: shape scheduling_legs rows into the leg-object array the existing
// dashboard list components (FlightsList/TripsList) consume. Each leg is the
// stored LevelFlight snapshot with a _mirror provenance tag attached. Rows
// without a snapshot (e.g. future native-only legs) are dropped.
export function mirrorLegsFromRows(rows) {
  return (rows || [])
    .filter((r) => r && r.lf_synced_snapshot)
    .map((r) => ({
      ...r.lf_synced_snapshot,
      _mirror: {
        origin: r.origin,
        locally_modified: r.locally_modified,
        upstream_changed: r.upstream_changed,
      },
    }));
}
```

- [ ] **Step 4: Run to verify it passes.** Run: `node --test backend/src/scheduling/mirrorLegs.test.js` — Expected: PASS, both tests pass.

- [ ] **Step 5: Add the endpoint.** In `backend/src/routes/scheduling.js`, add the import at the top alongside the existing imports (after the `formatSyncStatus` import line):

```js
import { mirrorLegsFromRows } from '../scheduling/mirrorLegs.js';
```

Then add this route immediately AFTER the existing `router.get('/sync-status', ...)` handler block (before `export default router;`):

```js
// GET /api/scheduling/legs — mirrored legs (LevelFlight shape) for the read UI.
router.get('/legs', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('scheduling_legs')
      .select('lf_synced_snapshot, origin, locally_modified, upstream_changed');
    if (error) throw error;
    res.json({ legs: mirrorLegsFromRows(data) });
  } catch (e) {
    res.status(502).json({ error: e.message, legs: [] });
  }
});
```

- [ ] **Step 6: Syntax-check the route.** Run: `node --check backend/src/routes/scheduling.js` — Expected: no output (valid).

- [ ] **Step 7: Commit.**

```bash
git add backend/src/scheduling/mirrorLegs.js backend/src/scheduling/mirrorLegs.test.js backend/src/routes/scheduling.js
git commit -m "feat(scheduling): GET /api/scheduling/legs serves mirror legs"
```

---

### Task 2: Frontend — Scheduling page, route, sidebar link

**Files:**
- Create: `frontend/src/pages/Scheduling.jsx`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/Sidebar.jsx`

- [ ] **Step 1: Create the page.** Create `frontend/src/pages/Scheduling.jsx` with EXACTLY this content (a clone of `Flights.jsx` pointed at the mirror endpoint, with the heading and copy updated):

```jsx
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import FlightsFilterBar from '../components/FlightsFilterBar';
import FlightsList from '../components/FlightsList';
import TripsList from '../components/TripsList';

// Reads the new scheduling MIRROR (scheduling_legs snapshots) rather than a live
// LevelFlight call. Reuses the existing list components unchanged.
export default function Scheduling() {
  const { data, loading, error } = useApi('/api/scheduling/legs');
  const legs = data?.legs || [];
  const [visible, setVisible] = useState([]);
  const [query, setQuery] = useState('');
  const [params, setParams] = useSearchParams();

  const q = query.trim().toLowerCase();
  const shown = q
    ? visible.filter((leg) => [
        leg.departure?.airport, leg.arrival?.airport,
        leg.dispatch?.aircraft?.tailNumber,
        leg.dispatch?.client?.company?.name,
        leg.dispatch?.tripId,
      ].some((v) => String(v ?? '').toLowerCase().includes(q)))
    : visible;
  const view = params.get('view') === 'legs' ? 'legs' : 'trips';
  const setView = (v) => setParams((p) => { const n = new URLSearchParams(p); v === 'legs' ? n.set('view', 'legs') : n.delete('view'); return n; }, { replace: true });

  const Tab = ({ id, label }) => (
    <button onClick={() => setView(id)}
      style={{ padding: '8px 18px', fontSize: 13, fontWeight: 500, cursor: 'pointer', background: 'none', border: 'none',
        color: view === id ? 'var(--accent)' : 'var(--text-secondary)',
        borderBottom: view === id ? '2px solid var(--accent)' : '2px solid transparent' }}>
      {label}
    </button>
  );

  return (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: '600', color: 'var(--text-primary)' }}>Scheduling</h1>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px' }}>
          {loading ? 'Loading from mirror...' : `${legs.length} legs · ${shown.length} shown · synced from LevelFlight`}
        </p>
      </div>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search route, tail, client, or trip #…"
        style={{ width: '100%', maxWidth: 360, padding: '8px 12px', marginBottom: 12, fontSize: 13, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', boxSizing: 'border-box' }}
      />

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
        <Tab id="trips" label="Trips" />
        <Tab id="legs" label="Legs" />
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '12px 16px', color: 'var(--danger)', marginBottom: '16px' }}>
          Error loading scheduling: {error}
        </div>
      )}

      <FlightsFilterBar legs={legs} onChange={setVisible} />
      {view === 'legs'
        ? <FlightsList legs={shown} loading={loading} />
        : <TripsList legs={shown} loading={loading} />}
    </div>
  );
}
```

- [ ] **Step 2: Add the route.** In `frontend/src/App.jsx`, add the import alongside the other page imports (anywhere with the other `import X from './pages/X';` lines):

```jsx
import Scheduling from './pages/Scheduling';
```

Then add this route immediately AFTER the existing `<Route path="/flights" element={<Flights />} />` line inside the Dashboard `<Routes>` block:

```jsx
        <Route path="/scheduling" element={<Scheduling />} />
```

- [ ] **Step 3: Add the sidebar link.** In `frontend/src/components/Sidebar.jsx`, add this entry to the `links` array immediately AFTER the `{ to: '/flights', label: 'Flights', icon: '✈' },` line:

```jsx
    { to: '/scheduling', label: 'Scheduling', icon: '🗓' },
```

- [ ] **Step 4: Build the frontend to verify it compiles.** Run from the repo root:

```bash
cd frontend && npm run build
```

Expected: the build completes successfully (exit 0), with `Scheduling.jsx` compiled and no import/syntax errors. (If `npm` reports missing modules, run `npm install` in `frontend/` first.)

- [ ] **Step 5: Commit.**

```bash
git add frontend/src/pages/Scheduling.jsx frontend/src/App.jsx frontend/src/components/Sidebar.jsx
git commit -m "feat(scheduling): Scheduling section reads the mirror (Trips/Legs list)"
```

- [ ] **Step 6: Manual visual check (human-run).** Start the frontend (`cd frontend && npm run dev`) and the backend (`cd backend && npm run dev`), log in, and open **Scheduling** in the sidebar. Expected: the Trips/Legs list renders the mirrored trips (the same data now in `scheduling_trips`/`legs`), with search and the date filter working — identical look to the Flights page but sourced from the mirror.

---

## Done

This proves the mirror feeds the dashboard UI through reused components. Next read-UI slices: the **Schedule board** (a mirror-backed variant of the calendar), then **trip detail** (reusing the trip-detail view), then passengers — after which we move into native create/edit (the trip builder).
