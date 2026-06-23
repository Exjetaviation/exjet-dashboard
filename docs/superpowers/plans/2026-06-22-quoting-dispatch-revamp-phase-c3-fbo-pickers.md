# Quoting → Dispatch Revamp — Phase C3 (FBO pickers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let dispatchers pick a **departure/arrival FBO per leg** in the Legs editor, sourced from the Phase-B FBO directory (`GET /api/scheduling/airport/:icao/fbos`), and store the chosen FBO on the native leg snapshot in the exact shape the documents read — so the later native itinerary/trip-sheet render FBO info.

**Architecture:** Backend: `buildNativeLegSnapshot` stores `departure.fbo`/`arrival.fbo` (the doc-VM FBO shape) from new `dep_fbo`/`arr_fbo` leg inputs; the create + edit-details paths pass them through (the leg input objects already flow end-to-end, so only the snapshot builder + its one call site change). Frontend: a reusable `FboPicker` component (lazy-fetches the airport's FBOs, emits the snapshot shape) wired into the Legs-tab edit rows. No migration — FBO is stored inside the existing `lf_synced_snapshot` jsonb.

**Tech Stack:** Node + Express, `node:test`, React + Vite. Backend test from `backend/`: `node --test src/scheduling/buildNativeLeg.test.js`. Frontend build: `cd frontend && npm run build`.

**Phase context:** C3 of Phase C; depends on C1 (tabbed Overview, merged) + Phase B (the `airport_fbos` directory + `/airport/:icao/fbos` route, merged). The FBO snapshot shape MUST match what the itinerary/trip-sheet `mapFbo` reads: `{ name, address:{street,city,state,postalCode}, phones:[], comms:{arinc,atg}, crewNote }`.

---

## File Structure

**Create:**
- `frontend/src/components/trip/FboPicker.jsx` — per-airport FBO `<select>` (lazy fetch + emits snapshot shape).

**Modify:**
- `backend/src/scheduling/buildNativeLeg.js` — add `departure.fbo`/`arrival.fbo`.
- `backend/src/scheduling/buildNativeLeg.test.js` — add an FBO test.
- `backend/src/routes/scheduling.js` — pass `dep_fbo`/`arr_fbo` into `buildNativeLegSnapshot` (one line).
- `frontend/src/pages/SchedulingTripDetail.jsx` — seed `dep_fbo`/`arr_fbo` in `startDetailsEdit`; render `FboPicker` in the edit-leg rows.

---

## Task 1: Backend — store FBO on the native leg snapshot

**Files:** Modify `backend/src/scheduling/buildNativeLeg.js`, `backend/src/scheduling/buildNativeLeg.test.js`, `backend/src/routes/scheduling.js:233`.

- [ ] **Step 1: Add the failing test** to `backend/src/scheduling/buildNativeLeg.test.js` (read the file first; append this test, keep existing ones):

```js
test('buildNativeLegSnapshot carries dep/arr FBO when provided', () => {
  const fbo = { fbo_id: '1039', name: 'BANYAN AIR SERVICE', address: { city: 'FORT LAUDERDALE' }, phones: ['800-200-2031'], comms: { arinc: '129.85' }, crewNote: null };
  const snap = buildNativeLegSnapshot({ dep_icao: 'KFXE', arr_icao: 'KTEB', dep_fbo: fbo, arr_fbo: null }, { id: 't1' });
  assert.deepEqual(snap.departure.fbo, fbo);
  assert.equal(snap.arrival.fbo, null);
});

test('buildNativeLegSnapshot fbo defaults to null', () => {
  const snap = buildNativeLegSnapshot({ dep_icao: 'KFXE', arr_icao: 'KTEB' }, { id: 't1' });
  assert.equal(snap.departure.fbo, null);
  assert.equal(snap.arrival.fbo, null);
});
```
(Ensure the test file imports `buildNativeLegSnapshot` and `assert`/`test` — match the existing file's imports.)

- [ ] **Step 2: Run it — FAIL** (`snap.departure.fbo` is `undefined`).
Run: `cd backend && node --test src/scheduling/buildNativeLeg.test.js`

- [ ] **Step 3: Add `fbo` to the snapshot.** In `buildNativeLeg.js`, change the `departure`/`arrival` lines:

```js
    departure: { airport: leg.dep_icao || null, time: toMs(leg.dep_time), fbo: leg.dep_fbo || null },
    arrival: { airport: leg.arr_icao || null, time: toMs(leg.arr_time), fbo: leg.arr_fbo || null },
```
And update the leg-shape comment (line 13) to note `dep_fbo`/`arr_fbo`.

- [ ] **Step 4: Run it — PASS.** Then run the whole scheduling suite to confirm no regression: `cd backend && node --test src/scheduling/*.test.js` → 0 fail.

- [ ] **Step 5: Pass FBO through the create/edit path.** In `backend/src/routes/scheduling.js`, the `buildNativeLegRows` helper builds each snapshot at line 233:
```js
    const snap = buildNativeLegSnapshot({ ...leg, pax: Number(l.pax) || 0, positioning: !!l.positioning }, ctx);
```
Change it to also forward the FBO from the input leg `l`:
```js
    const snap = buildNativeLegSnapshot({ ...leg, pax: Number(l.pax) || 0, positioning: !!l.positioning, dep_fbo: l.dep_fbo || null, arr_fbo: l.arr_fbo || null }, ctx);
```
(Both `POST /trips` and `PATCH /trips/:lfOid/details` go through `buildNativeLegRows`, so this one line covers create + edit. The leg input objects from the frontend will carry `dep_fbo`/`arr_fbo`.)

- [ ] **Step 6: Smoke-test the route imports** — `cd backend && node --input-type=module -e "import('./src/routes/scheduling.js').then(()=>console.log('IMPORT_OK')).catch(e=>{console.error(e.message);process.exit(1)})"` → IMPORT_OK.

- [ ] **Step 7: Commit**

```bash
git add backend/src/scheduling/buildNativeLeg.js backend/src/scheduling/buildNativeLeg.test.js backend/src/routes/scheduling.js
git commit -m "feat(scheduling): store dep/arr FBO on the native leg snapshot"
```

---

## Task 2: FboPicker component

**Files:** Create `frontend/src/components/trip/FboPicker.jsx`

- [ ] **Step 1: Write it**

```jsx
import { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';

// Per-airport FBO picker. Lazily fetches /api/scheduling/airport/:icao/fbos (which
// serves our directory + lazy-caches from LevelFlight). onChange emits the FBO in the
// leg-snapshot shape the documents read: { fbo_id, name, address, phones, comms, crewNote }.
const sel = { width: '100%', padding: '7px 10px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, boxSizing: 'border-box' };

export default function FboPicker({ icao, value, onChange, label }) {
  const [fbos, setFbos] = useState([]);
  const [loading, setLoading] = useState(false);
  const code = (icao || '').trim().toUpperCase();
  useEffect(() => {
    let live = true;
    if (code.length < 3) { setFbos([]); return; }
    setLoading(true);
    apiFetch(`/api/scheduling/airport/${code}/fbos`)
      .then((r) => r.json())
      .then((j) => { if (live) setFbos(j.fbos || []); })
      .catch(() => { if (live) setFbos([]); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [code]);

  const toSnapshot = (row) => row ? {
    fbo_id: row.fbo_id, name: row.name, address: row.address || null,
    phones: row.phones || null, comms: row.comms || null, crewNote: null,
  } : null;

  return (
    <div style={{ flex: '1 1 150px' }}>
      {label && <label style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{label}</label>}
      <select value={value?.fbo_id || ''} disabled={code.length < 3}
        onChange={(e) => onChange(toSnapshot(fbos.find((f) => f.fbo_id === e.target.value)))} style={sel}>
        <option value="">{loading ? 'loading…' : (code.length < 3 ? '—' : (fbos.length ? '— FBO —' : 'no FBOs'))}</option>
        {fbos.map((f) => <option key={f.fbo_id} value={f.fbo_id}>{f.name}</option>)}
        {value?.fbo_id && !fbos.some((f) => f.fbo_id === value.fbo_id) && (
          <option value={value.fbo_id}>{value.name}</option>
        )}
      </select>
    </div>
  );
}
```

- [ ] **Step 2: Build check** — `cd frontend && npm run build` → succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/trip/FboPicker.jsx
git commit -m "feat(trip): per-airport FBO picker component"
```

---

## Task 3: Wire FboPicker into the Legs editor

**Files:** Modify `frontend/src/pages/SchedulingTripDetail.jsx`

**READ the current file.** The edit-leg rows are in the `detailsEdit.legs.map((l, i) => (...))` block (under the `legs` tab, ~line 397). Each row has From/To/Departure/Pax/Ferry/remove. `startDetailsEdit` (~line 296) seeds each leg from `legsForView`. `updateEditLeg(i, field, v)` updates a leg field. `saveDetails` already sends the `detailsEdit.legs` objects to `PATCH /trips/:id/details`.

- [ ] **Step 1: Import the picker** (with the other imports):
```jsx
import FboPicker from '../components/trip/FboPicker';
```

- [ ] **Step 2: Seed FBO in `startDetailsEdit`.** In the `legs:` map inside `setDetailsEdit({...})` (~line 300), the object currently is:
```jsx
      dep_icao: l.departure?.airport || '', arr_icao: l.arrival?.airport || '',
      dep_time: toLocalInput(l.departure?.time), pax: l.passengerCount || '', positioning: !!l.isPositioning,
```
Add the two FBO fields to that object:
```jsx
      dep_fbo: l.departure?.fbo || null, arr_fbo: l.arrival?.fbo || null,
```

- [ ] **Step 3: Render the pickers in each edit-leg row.** Inside the `detailsEdit.legs.map((l, i) => (...))` row, AFTER the Ferry `<label>` and BEFORE the remove `<button>` (or wrap them onto the next line — the row is a `flexWrap` container), add:
```jsx
                <FboPicker label="Dep FBO" icao={l.dep_icao} value={l.dep_fbo} onChange={(fbo) => updateEditLeg(i, 'dep_fbo', fbo)} />
                <FboPicker label="Arr FBO" icao={l.arr_icao} value={l.arr_fbo} onChange={(fbo) => updateEditLeg(i, 'arr_fbo', fbo)} />
```

- [ ] **Step 4: Build check** — `cd frontend && npm run build` → succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/SchedulingTripDetail.jsx
git commit -m "feat(trip): dep/arr FBO pickers in the Legs editor"
```

---

## Task 4: Verification

- [ ] **Step 1: Tests + build** — `cd backend && node --test src/scheduling/*.test.js` (0 fail) and `cd frontend && npm run build` (green).

- [ ] **Step 2: Manual checklist** (user, on a native trip, Legs tab → Edit trip):
  - Each leg row shows **Dep FBO** + **Arr FBO** dropdowns; once From/To have valid ICAOs, the dropdowns populate from the FBO directory (e.g. KFXE → Banyan Air Service; first request for a new airport lazy-fetches from LF).
  - Pick FBOs, Save → re-open Edit: the chosen FBOs persist (stored in the leg snapshot).
  - (FBO display on the documents comes with the later native itinerary/trip-sheet phase; C3 just captures + stores it.)

---

## C3 — Definition of Done

- `node --test src/scheduling/*.test.js` passes (incl. the 2 new FBO snapshot tests).
- `cd frontend && npm run build` passes.
- FBO pickers appear in the Legs editor, populate from `/airport/:icao/fbos`, and the chosen FBO persists on the leg snapshot at `departure.fbo`/`arrival.fbo` in the doc-VM shape.

## Notes for C4/C5
- C5's New-Quote page can reuse `FboPicker` the same way once it has per-leg airports.
- The stored `departure.fbo`/`arrival.fbo` is exactly what the future native itinerary/trip-sheet `mapFbo` reads — no further shape work needed there.
