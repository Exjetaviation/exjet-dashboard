# Scheduling Board (Mirror-backed) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Scheduling section a distinct **Schedule board** (the By-Aircraft calendar) sourced from the mirror, so it's no longer a look-alike of the Flights page. Reuse the existing `Calendar` component by parameterizing its legs source.

**Architecture:** Read-UI slice of the scheduling-dispatcher-web sub-project. `Calendar.jsx` builds its board entirely from the legs it fetches at one line (`useApi('/api/levelflight/legs')`). We add an optional `legsEndpoint` prop (default = the current live endpoint, so the existing `/calendar` page is unchanged — this is the shared-component approach from the spec) and point a new Scheduling "Schedule" view at `/api/scheduling/legs`. The Scheduling page becomes a small section shell with a top-level **Schedule | Trips** switch: Schedule renders the mirror-backed board; Trips reuses the existing list components. Duty/maintenance/ADS-B overlays keep their current sources (they're supplementary and not part of the mirror yet).

**Tech Stack:** React 19 + Vite, React Router 7, inline styles. Verified by `npm run build` + a manual visual check (no frontend unit-test runner).

**Visual risk to verify:** `Calendar` is a full-page component; rendering it inside the Scheduling section's tab should work but is worth a visual check. If it doesn't lay out well embedded, the fallback is a dedicated full-width `/scheduling/board` route — noted at the end.

---

## File Structure

- `frontend/src/pages/Calendar.jsx` — **modify.** Add optional `legsEndpoint` prop (2 lines).
- `frontend/src/pages/Scheduling.jsx` — **rewrite.** Section shell with Schedule (board) + Trips (list) views.

---

### Task 1: Parameterize Calendar's legs source

**Files:**
- Modify: `frontend/src/pages/Calendar.jsx`

- [ ] **Step 1: Read the file** `frontend/src/pages/Calendar.jsx` and confirm lines 55–56 read exactly:

```jsx
export default function Calendar() {
  const {data,loading}  = useApi('/api/levelflight/legs');
```

- [ ] **Step 2: Edit the function signature.** Replace this exact line:

```jsx
export default function Calendar() {
```

with:

```jsx
export default function Calendar({ legsEndpoint = '/api/levelflight/legs' } = {}) {
```

- [ ] **Step 3: Edit the legs fetch.** Replace this exact line:

```jsx
  const {data,loading}  = useApi('/api/levelflight/legs');
```

with:

```jsx
  const {data,loading}  = useApi(legsEndpoint);
```

Change nothing else in the file. (The existing `/calendar` route renders `<Calendar />` with no prop, so it still uses the live endpoint — behavior unchanged.)

- [ ] **Step 4: Build to verify it compiles.** Run from the repo root:

```bash
cd frontend && npm run build
```

Expected: build succeeds (exit 0), no errors.

- [ ] **Step 5: Commit.**

```bash
git add frontend/src/pages/Calendar.jsx
git commit -m "feat(scheduling): Calendar accepts optional legsEndpoint prop"
```

---

### Task 2: Scheduling section — Schedule board + Trips list

**Files:**
- Modify (rewrite): `frontend/src/pages/Scheduling.jsx`

- [ ] **Step 1: Replace the file.** Overwrite `frontend/src/pages/Scheduling.jsx` with EXACTLY this content:

```jsx
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import FlightsFilterBar from '../components/FlightsFilterBar';
import FlightsList from '../components/FlightsList';
import TripsList from '../components/TripsList';
import Calendar from './Calendar';

// The new Scheduling section — sourced from the MIRROR (scheduling_legs) rather
// than a live LevelFlight call. "Schedule" is the board (mirror-backed Calendar);
// "Trips" reuses the existing list components. The board is what distinguishes
// this section from the live Flights page.
export default function Scheduling() {
  const [section, setSection] = useState('schedule');

  const SectionTab = ({ id, label }) => (
    <button onClick={() => setSection(id)}
      style={{ padding: '8px 18px', fontSize: 13, fontWeight: 500, cursor: 'pointer', background: 'none', border: 'none',
        color: section === id ? 'var(--accent)' : 'var(--text-secondary)',
        borderBottom: section === id ? '2px solid var(--accent)' : '2px solid transparent' }}>
      {label}
    </button>
  );

  return (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: '600', color: 'var(--text-primary)' }}>Scheduling</h1>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px' }}>Synced from LevelFlight</p>
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
        <SectionTab id="schedule" label="Schedule" />
        <SectionTab id="trips" label="Trips" />
      </div>

      {section === 'schedule'
        ? <Calendar legsEndpoint="/api/scheduling/legs" />
        : <TripsView />}
    </div>
  );
}

// The Trips list view — the existing list components fed by the mirror.
function TripsView() {
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

      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
        {loading ? 'Loading from mirror...' : `${legs.length} legs · ${shown.length} shown`}
      </p>
      <FlightsFilterBar legs={legs} onChange={setVisible} />
      {view === 'legs'
        ? <FlightsList legs={shown} loading={loading} />
        : <TripsList legs={shown} loading={loading} />}
    </div>
  );
}
```

- [ ] **Step 2: Build to verify it compiles.** Run from the repo root:

```bash
cd frontend && npm run build
```

Expected: build succeeds (exit 0), no errors.

- [ ] **Step 3: Commit.**

```bash
git add frontend/src/pages/Scheduling.jsx
git commit -m "feat(scheduling): add mirror-backed Schedule board to the section"
```

- [ ] **Step 4: Manual visual check (human-run).** Start backend + frontend, open **Scheduling**. Expected: it opens on the **Schedule** board (By-Aircraft calendar) showing the mirrored trips as blocks; the **Trips** tab shows the list. Confirm the board renders correctly embedded in the section (this is the visual risk noted above).

---

## Fallback (only if the embedded board lays out poorly)

If `Calendar` doesn't render cleanly inside the Scheduling section's tab, switch the Schedule view to a dedicated full-width route instead: add `<Route path="/scheduling/board" element={<Calendar legsEndpoint="/api/scheduling/legs" />} />` in `App.jsx`, and make the "Schedule" tab a link to it rather than an inline render. (Not done by default — only if the visual check shows a problem.)

## Done

The Scheduling section now has a board the Flights page doesn't — a real, distinct view. Next: trip detail (reuse the trip-detail view), passengers, then native create/edit (the trip builder).
