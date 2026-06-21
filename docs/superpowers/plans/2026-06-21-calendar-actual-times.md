# Calendar Actual Departure/Arrival — Implementation Plan

**Goal:** Show scheduled-vs-actual departure/arrival on the calendar as red (late) /
green (early) overlay segments, driven by ADS-B, with a 5-minute threshold; persist
actuals for completed legs.

**Architecture:** Derive `actual_dep_time`/`actual_arr_time` from the firehose
`on_ground` series inside the existing flight-track reconciler; expose by leg id;
the calendar overlays delta segments (using the live ADS-B feed for in-progress legs
and the persisted actuals for completed ones). See the design spec dated 2026-06-21.

**Tech:** Node/Express + Supabase backend (`node:test`), React/Vite calendar.

**Threshold constant:** `DELAY_THRESHOLD_MS = 5 * 60 * 1000` (shared idea; defined per
side). 

---

## Phase 1 — Backend: derive + persist actuals

### Task 1: `deriveActualTimes` pure helper (`adsbTrack.js`) + tests
Derive wheels-up/down from a tail's clipped firehose positions.

```js
// In backend/src/services/adsbTrack.js
// From time-ordered positions ({ t, on_ground }) within a leg window, return the
// actual departure (first ground->air) and arrival (first air->ground after airborne)
// as epoch ms, or null when not observable.
export function deriveActualTimes(positions, leg, padMs) {
  const lo = leg.depTime - padMs, hi = leg.arrTime + padMs;
  const pts = (positions || []).filter((p) => p.t >= lo && p.t <= hi).sort((a, b) => a.t - b.t);
  let actualDep = null, actualArr = null, airborne = false;
  for (let i = 0; i < pts.length; i++) {
    const onG = !!pts[i].on_ground;
    if (!airborne && onG === false) { airborne = true; if (actualDep == null) actualDep = pts[i].t; }
    else if (airborne && onG === true) { actualArr = pts[i].t; break; }
  }
  return { actualDep, actualArr };
}
```

- [ ] Add the function.
- [ ] Tests in `adsbTrack.test.js`: (a) clean ground→air→ground → both times; (b) starts
  airborne (no prior ground) → `actualDep` = first sample, no false transition; (c) never
  lands within window → `actualArr` null; (d) all on-ground → both null; (e) respects pad
  window. Run `node --test backend/src/services/adsbTrack.test.js`.

### Task 2: Migration — `flight_tracks` actual columns
- [ ] `backend/migrations/00X_flight_track_actuals.sql`:
  ```sql
  alter table public.flight_tracks
    add column if not exists actual_dep_time timestamptz,
    add column if not exists actual_arr_time timestamptz;
  ```
- [ ] Apply via the repo's migration runner (same path as prior migrations).

### Task 3: `flightTrackStore.upsertFlightTrack` persists actuals
- [ ] Add `actual_dep_time`, `actual_arr_time` to the upsert payload (pass-through of the
  caller's ISO strings or null).
- [ ] Add `actual_dep_time`/`actual_arr_time` to `getStoredLegIds`-adjacent reads if needed
  by the endpoint (Task 5 reads them directly).

### Task 4: Reconciler computes + passes actuals (`flightTrackReconciler.js`)
- [ ] Inside the per-leg loop (where `track = clipTrackToLeg(positions, leg, PAD_MS)`),
  also `const { actualDep, actualArr } = deriveActualTimes(positions, leg, PAD_MS);`.
- [ ] Pass to `upsertFlightTrack`: `actual_dep_time: actualDep ? new Date(actualDep).toISOString() : null`
  (same for arr).
- [ ] Keep the existing ≥2-point gate; actuals may be null even when a track stores.

### Task 5: `GET /api/adsb/actuals` endpoint (`routes/adsb.js`)
- [ ] `GET /api/adsb/actuals?from=<ms>&to=<ms>` → query `flight_tracks`
  `select leg_id, actual_dep_time, actual_arr_time where dep_time in [from,to]`
  (cap range; default to a sane window). Return `{ actuals: { [leg_id]: { actualDep:
  <ms|null>, actualArr: <ms|null> } } }`.
- [ ] Store read helper in `flightTrackStore.js` (`getActualsInRange(fromIso, toIso)`).
- [ ] Soft-fail to `{ actuals: {} }` on error (matches the route's existing style).

---

## Phase 2 — Frontend: render delta segments

### Task 6: `delaySegments` pure helper + tests
```js
// frontend/src/lib/delaySegments.js
const DELAY_THRESHOLD_MS = 5 * 60 * 1000;
// Returns [{ from, to, kind: 'late'|'early', edge: 'dep'|'arr' }] for a leg.
export function delaySegments({ dep, arr, actualDep, actualArr, now, onGround, airborne }) {
  const out = [];
  // Departure: settled actual, else live "still on the ground past dep".
  const effDep = actualDep != null ? actualDep : (onGround && now > dep ? now : null);
  if (effDep != null && Math.abs(effDep - dep) >= DELAY_THRESHOLD_MS) {
    out.push(effDep > dep ? { from: dep, to: effDep, kind: 'late', edge: 'dep' }
                          : { from: effDep, to: dep, kind: 'early', edge: 'dep' });
  }
  // Arrival: settled actual, else live "still airborne past arr".
  const effArr = actualArr != null ? actualArr : (airborne && now > arr ? now : null);
  if (effArr != null && Math.abs(effArr - arr) >= DELAY_THRESHOLD_MS) {
    out.push(effArr > arr ? { from: arr, to: effArr, kind: 'late', edge: 'arr' }
                          : { from: effArr, to: arr, kind: 'early', edge: 'arr' });
  }
  return out;
}
```
- [ ] Add file + tests (`delaySegments.test.js` if the frontend has a test runner, else a
  small node test): late dep, early dep, live undeparted (onGround+now>dep), late arr,
  live airborne-past-arr, sub-threshold → none, settled-actual-precedence-over-live.

### Task 7: Fetch persisted actuals into the calendar
- [ ] Small fetch (reuse the calendar's range) to `GET /api/adsb/actuals?from&to` →
  `actuals` map by leg id. Either a `useLegActuals(rangeStart, rangeEnd)` hook (poll ~60s)
  or fold into the existing legs load. Keyed by `leg._id.$oid`.

### Task 8: Render overlay segments (`Calendar.jsx`)
- [ ] Per leg, gather inputs: `dep/arr` (existing), `actualDep`/`actualArr` from the
  actuals map, plus live: `onGround = live[tail]?.onGround === true`,
  `airborne = airborneLegId[tail] === legId`, and live `airborneSinceMs` as `actualDep`
  fallback when airborne on this leg and no persisted dep.
- [ ] `const segs = delaySegments({...})`; for each, position with the existing
  `getBlock(seg.from, seg.to)` and render an absolutely-positioned overlay `<div>` on the
  leg row (`top:FLIGHT_TOP, height:FLIGHT_H`), color by `kind` (late→`var(--danger)`,
  early→success green), ~0.35 alpha so the block reads through, `pointerEvents:none`.
- [ ] Tooltip on the segment: e.g. `Departed 18 min late` / `Arriving ~12 min late`.
- [ ] Verify against a live/looked-back trip (#25093 or current day): segments line up
  with the block and grow with the now-bar.

---

## Verification
- [ ] `node --test backend/src/services/*.test.js` green (incl. new `deriveActualTimes`).
- [ ] Frontend builds (`npm run build`).
- [ ] Manual: pick a recently-completed leg with a known delay → red segment of the right
  width; an on-time leg → no segment; an in-progress undeparted leg past its dep → growing
  red.

## Rollout / sequencing
1. Phase 1 behind the existing recorder/reconciler (no UI change yet) — actuals start
   accumulating. Commit + push.
2. Phase 2 — calendar overlay. Commit + push.
Each phase is independently shippable; review diffs before each push (per standing rule).
