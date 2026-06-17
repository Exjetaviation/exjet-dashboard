# Flight Track Direct Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a flight has no real ADS-B track (snapshot or live), draw a dashed direct departure→arrival line labeled "direct route", using airport coordinates the leg already carries.

**Architecture:** Frontend-only. `FlightDetail` derives a 2-point line from `leg._calc.from/to.location` when `fetchFlightTrack` returns an empty track, tagging it `source: 'direct'`. `FlightTrackMap` renders `direct` tracks dashed-grey with a "direct route" badge, distinct from the solid-blue flown path. No backend, endpoint, or migration changes.

**Tech Stack:** React + Vite, Leaflet.

---

## File Structure

- `frontend/src/pages/FlightDetail.jsx` (modify) — in the existing track-fetch effect, derive the direct line when the fetched track is empty.
- `frontend/src/components/FlightTrackMap.jsx` (modify) — dashed style + "direct route" badge for `source === 'direct'`; add `source` to the draw effect deps.

No tests added: the derive is a trivial inline guard and the rest is visual. Verified via eslint + `npm run build` + manual check (per the design spec).

---

## Task 1: `FlightDetail` — derive the direct line on empty track

**Files:**
- Modify: `frontend/src/pages/FlightDetail.jsx`

**Context:** The component already fetches the track in a `useEffect` keyed on `legId`. The effect currently always does `setFlightTrack(res)`. `leg._calc.from.location` (departure) and `leg._calc.to.location` (arrival) carry `{lat, lng}` airport coordinates (the fleet map uses the same fields). `fetchFlightTrack` resolves to `{ track: [[lat,lng],...], source }` where an empty result is `{ track: [], source: 'none' }`.

- [ ] **Step 1: Replace the effect body's set-state with the direct-line derive**

In `frontend/src/pages/FlightDetail.jsx`, the current effect (around lines 78-91) reads:

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

Change ONLY the `if (alive) setFlightTrack(res);` line into the block below (leave the rest of the effect identical):

```js
      if (!alive) return;
      if (res.track?.length) {
        setFlightTrack(res);
      } else {
        // No real ADS-B track (historical flight) — fall back to a direct
        // departure->arrival line from the airport coords the leg carries.
        const a = leg?._calc?.from?.location;
        const b = leg?._calc?.to?.location;
        if (a?.lat != null && a?.lng != null && b?.lat != null && b?.lng != null) {
          setFlightTrack({ track: [[a.lat, a.lng], [b.lat, b.lng]], source: 'direct' });
        } else {
          setFlightTrack(res); // no coords either — leaves the empty state
        }
      }
```

- [ ] **Step 2: Lint**

Run: `cd frontend && npx eslint src/pages/FlightDetail.jsx`
Expected: no NEW errors from this change. (A pre-existing `react-hooks/set-state-in-effect` error on the unrelated ForeFlight effect at ~line 60, and the pre-existing `exhaustive-deps` warning on this effect's `[legId]` deps, may still be reported — do NOT "fix" unrelated code, and keep the `[legId]` deps as-is.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/FlightDetail.jsx
git commit -m "FlightDetail: fall back to a direct airport-to-airport line when no ADS-B track"
```

---

## Task 2: `FlightTrackMap` — dashed style + "direct route" badge

**Files:**
- Modify: `frontend/src/components/FlightTrackMap.jsx`

**Context:** The component draws the track in a `useEffect` that currently always uses the solid-blue polyline style and lists `[track, from, to]` as deps. It renders a "live" badge overlay when `source === 'live'`. A `direct` track always has 2 points, so it never triggers the empty-state overlay.

- [ ] **Step 1: Style the polyline by `source` and add `source` to deps**

In `frontend/src/components/FlightTrackMap.jsx`, the draw effect currently contains:

```js
    if (!track.length) return;
    const group = L.layerGroup();
    L.polyline(track, { color: '#38bdf8', weight: 3, opacity: 0.85 }).addTo(group);
```

Replace the `L.polyline(...)` line with a source-dependent style:

```js
    if (!track.length) return;
    const group = L.layerGroup();
    const lineStyle = source === 'direct'
      ? { color: '#94a3b8', weight: 2, opacity: 0.7, dashArray: '6 6' } // dashed grey = planned/approximate
      : { color: '#38bdf8', weight: 3, opacity: 0.85 };                  // solid blue = real flown track
    L.polyline(track, lineStyle).addTo(group);
```

Then change that effect's dependency array from:

```js
  }, [track, from, to]);
```
to:
```js
  }, [track, from, to, source]);
```

- [ ] **Step 2: Add the "direct route" badge (replace the live-only badge block)**

The component currently renders only a live badge:

```jsx
      {source === 'live' && track.length > 0 && (
        <span style={{ position: 'absolute', top: 10, right: 10, zIndex: 500, fontSize: 11, padding: '3px 8px', borderRadius: 6, background: 'rgba(56,189,248,0.15)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.4)' }}>
          live
        </span>
      )}
```

Replace that entire block with one that handles both `live` and `direct`:

```jsx
      {(source === 'live' || source === 'direct') && track.length > 0 && (
        <span style={{
          position: 'absolute', top: 10, right: 10, zIndex: 500, fontSize: 11,
          padding: '3px 8px', borderRadius: 6,
          background: source === 'direct' ? 'rgba(148,163,184,0.15)' : 'rgba(56,189,248,0.15)',
          color: source === 'direct' ? '#94a3b8' : '#38bdf8',
          border: source === 'direct' ? '1px solid rgba(148,163,184,0.4)' : '1px solid rgba(56,189,248,0.4)',
        }}>
          {source === 'direct' ? 'direct route' : 'live'}
        </span>
      )}
```

- [ ] **Step 3: Lint**

Run: `cd frontend && npx eslint src/components/FlightTrackMap.jsx`
Expected: clean (no errors).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/FlightTrackMap.jsx
git commit -m "FlightTrackMap: dashed grey + 'direct route' badge for direct fallback"
```

---

## Task 3: Verification

- [ ] **Step 1: Lint both changed files + build**

Run: `cd frontend && npx eslint src/components/FlightTrackMap.jsx && npm run build 2>&1 | grep -E "built in|error|Error" | head`
Expected: `FlightTrackMap.jsx` lint clean; `✓ built in ...` with no errors. (The build compiles `FlightDetail.jsx` too, so a clean build confirms the page change integrates.)

- [ ] **Step 2: Manual check (requires running frontend + backend)**

- Open a HISTORICAL flight (no ADS-B track): a **dashed grey** line from departure to arrival airport + a **"direct route"** badge.
- Open a flight WITH a real ADS-B track: **solid blue** path, **no** "direct" badge (unchanged).
- Open a flight whose leg lacks `_calc.from/to.location`: the **empty state** ("No flight path recorded") still shows.

---

## Notes for the implementer

- **Scope:** flight detail page only. Do not touch the fleet map (`Map.jsx`) previous-flights view.
- **No backend changes:** the fallback is entirely client-side; the `/api/adsb/flight-track/:legId` endpoint and the reconciler are untouched.
- **Don't fix pre-existing lint** in `FlightDetail.jsx` (the ForeFlight effect's `set-state-in-effect` error and this effect's `exhaustive-deps` warning predate / are intrinsic to this work and are out of scope).
- **YAGNI:** a straight 2-point line is intended (no great-circle interpolation).
