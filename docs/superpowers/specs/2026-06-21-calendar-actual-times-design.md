# Calendar Actual Departure/Arrival (ADS-B delay overlay) — Design

**Date:** 2026-06-21
**Status:** Approved-pending-review

## Goal

On the scheduling calendar, show the discrepancy between a flight's **scheduled**
and **actual** departure/arrival, driven by ADS-B. As the now-bar passes a flight
that hasn't taken off (per ADS-B), redden the gap; extend red past a scheduled
arrival a flight is late to make. Mark early departures/arrivals green. Persist
actuals so delays remain visible after landing and after a refresh.

## Decisions (from brainstorming)

- **Scope:** live overlay **and** persisted actuals.
- **Block style:** the scheduled block stays anchored; delay/early **delta segments**
  overlay its front and extend past its end.
- **Colors:** red = late, green = early.
- **Threshold:** only show a delta of **≥ 5 minutes**.

## What ADS-B gives us (ground truth)

- `adsb_positions` firehose (14-day) per fleet tail: `{ lat, lon, t (epoch ms), on_ground }`
  every ~20s (`adsbRecorder.js` + `adsbStore.queryTrack`).
- Live feed `/api/adsb/positions` already exposes per-tail `onGround` and
  `airborneSinceMs` (wheels-up time, from `detectTakeoff` ground→air transition).
- The calendar already polls this (`useAdsb(20000)`) and already computes
  `airborneLegId[tail]` (which leg an airborne tail is on).
- **Takeoff** time = ground→air transition (have it). **Landing** time = air→ground
  transition (derivable from the `on_ground` series; ~20s precision). ADS-B gives no
  explicit wheels-down timestamp, so air→ground is our landing proxy.

## Architecture

Two sources feed the same render:

### A. Persisted actuals — backend (REVISED after review)
Persist into a dedicated `leg_actuals` table (migration 017; supersedes 016's
`flight_tracks` columns), with two writers and a source-priority merge
(`live` > `exact` > `approx`, never downgraded):

**Primary — the LIVE recorder (the same engine behind the fleet-map status).**
`adsbRecorder.tick()` runs `detectTakeoff` on every poll (full stream, no movement
gate), so it sees the real on-ground→air / air→ground transitions the stored firehose
drops. On a transition it matches the tail to its current leg (`matchActiveLeg` +
`activeLegs` cache — the server-side version of the calendar's airborne-leg match) and
records `actual_dep`/`actual_arr` (source `live`) the moment it happens.

**Backfill — the reconciler (best-effort).** For completed legs with no `leg_actuals`
row yet, derive from the stored firehose:
- `deriveActualTimes(positions, leg, pad)` — exact: first ground→air / air→ground
  transition; null when none observed (honest).
- `approximateActualTimes(positions, leg, pad)` — fallback: first/last airborne sample
  (a few min off), for the common case where crowd-sourced ADS-B never reported the
  ground portion.
- Source `exact` or `approx` accordingly.

**Endpoint** `GET /api/adsb/actuals?from=<ms>&to=<ms>` → `{ [legId]: { actualDep,
actualArr, depSource, arrSource } }` for `leg_actuals` rows whose scheduled `dep_time`
falls in range (`leg_id` = the calendar's `leg._id.$oid`). The calendar can flag
`approx` segments visually.

> Why not derive everything from `flight_tracks`/the firehose (the original plan)? The
> firehose only saves a row when the plane *moved* (`hasMoved`), so parked/on-ground
> samples are dropped and most ground→air transitions don't survive — verified: a
> backfill over the firehose came up almost empty. The live recorder is the reliable
> source; the firehose is a fallback only.

### B. Live actuals (in-progress legs) — frontend, no new backend
The calendar already has the live feed:
- **Departure (live):** if the leg's tail is airborne on this leg
  (`airborneLegId`), `actualDep = live[tail].airborneSinceMs`.
- **Undeparted (live):** if ADS-B confirms the tail is **on the ground**
  (`live[tail].onGround === true`) and `now > dep`, the departure delay is open →
  red `[dep → now]`, growing each 60s tick.
- **Arrival (live):** if the tail is airborne on this leg and `now > arr`, the arrival
  delay is open → red `[arr → now]`, growing. (No live wheels-down; persisted fills it
  in after landing.)

Precedence per leg: persisted actual (settled) wins when present; otherwise live.

### C. Rendering (frontend `Calendar.jsx`)
Pure helper `delaySegments({ dep, arr, actualDep, actualArr, now, onGround, airborne,
thresholdMs })` → array of `{ from, to, kind: 'late'|'early' }` time-intervals:

- **Departure delta:** `actualDep` (or `now` while still on-ground past dep) vs `dep`.
  late → `[dep → actualDep]` red; early → `[actualDep → dep]` green.
- **Arrival delta:** `actualArr` (or `now` while still airborne past arr) vs `arr`.
  late → `[arr → actualArr]` red; early → `[actualArr → arr]` green.
- Apply the **5-minute threshold**: drop any interval shorter than `thresholdMs`.

Each interval is positioned with the existing ms→px math (`getBlock(from, to)`),
rendered as an overlay `<div>` on the leg row: red `var(--danger)`, green a success
tone, semi-transparent so the scheduled block reads through. They line up with the
block and grow with the now-bar (the calendar already re-renders every 60s).

## Edge cases / guardrails

- **No phantom delays:** the live growing-red only fires for tails we actually track
  on ADS-B with a confirming on-ground/airborne state. Untracked tails get nothing
  live; they still get persisted actuals once their leg completes (if positions exist).
- **Threshold both ways:** <5 min late/early renders as a normal on-time block.
- **Overnight/clipped blocks:** segments use the same `getBlock` clamp, so they respect
  `rangeStart`/`rangeEnd` like the blocks do.
- **Reconciler idempotence preserved:** actuals are written with the same upsert that
  already gates on a ≥2-point track; null actuals are allowed (a track can exist
  without a clean transition).
- **Positioning legs** (no pax) are treated like any other leg — they have scheduled
  times and can be delayed.

## Files touched

- `backend/migrations/00X_flight_track_actuals.sql` (new) — add two columns.
- `backend/src/services/adsbTrack.js` — add `deriveActualTimes` (pure, unit-tested).
- `backend/src/services/flightTrackStore.js` — persist the two new fields.
- `backend/src/services/flightTrackReconciler.js` — compute + pass actuals.
- `backend/src/routes/adsb.js` — `GET /actuals` endpoint.
- `frontend/src/hooks/` — small fetch for `/api/adsb/actuals` (or fold into the legs load).
- `frontend/src/lib/` — `delaySegments` pure helper (unit-tested).
- `frontend/src/pages/Calendar.jsx` — render the overlay segments per leg.

## Out of scope (v1)

- Exact wheels-down (we use air→ground ~20s proxy).
- Delay reasons/codes, notifications, or per-leg status persistence on `scheduling_legs`.
- Reflowing the block to actual times (we keep the scheduled block + overlays).
