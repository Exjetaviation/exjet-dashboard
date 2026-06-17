# Per-Flight Track Map — design

**Date:** 2026-06-17
**Status:** Approved (design)

## Problem

The fleet map (`frontend/src/pages/Map.jsx`) can show an aircraft's recent flight
paths, but those tracks are reconstructed on demand from the rolling
`adsb_positions` table and age out with it. Individual flight pages
(`frontend/src/pages/FlightDetail.jsx`) show no map at all. We want each flight's
detail page to display that specific flight's flown path, and we want flight
paths kept **permanently** — not subject to the raw-position retention window.

## Goal

- Each flight's detail page shows a map of that flight's real ADS-B flown path.
- A completed flight's path is captured **once** as a compact snapshot and stored
  permanently, keyed by the flight's leg id. It never ages out.
- A flight that is in progress (or just landed, not yet snapshotted) still shows
  its track live, built on the fly from raw positions.
- The raw `adsb_positions` firehose stays bounded (drops to 14 days) since it is
  no longer the system of record for history.

Non-goal: refactoring the monolithic `Map.jsx`. The new per-flight map is a
standalone component; `Map.jsx` is left as-is.

## Design decisions (resolved during brainstorming)

- **What shows on the page:** live + completed. In-progress/just-landed flights
  show the track building live from raw positions; completed flights show the
  permanent snapshot.
- **Backfill:** one-time backfill of the last 90 days of completed flights (run
  while raw data still spans 90 days), so recent flight pages have maps
  immediately.
- **Placement:** a full-width map section below the page header, above the
  existing two-column info grid.
- **Raw retention:** reduce `adsb_positions` retention from 90 → 14 days, since
  completed flights are now stored permanently as snapshots. **This reduction
  happens only AFTER the 90-day backfill runs.**

## Architecture

A periodic **reconciler** job captures completed flights into a new permanent
`flight_tracks` table. A per-flight endpoint serves the snapshot (or a live
fallback for in-progress flights). The flight detail page renders a standalone
`FlightTrackMap` component.

### Why the reconciler (vs. alternatives)

- **Chosen — periodic reconciler:** reuses the exact leg-fetch + clip logic the
  existing `/api/adsb/previous-flights` endpoint already uses; idempotent;
  survives restarts; the same function performs the one-time backfill (run over
  a wider window). A flight is captured within ~1h of completion, not instantly —
  acceptable.
- **Rejected — landing-triggered in the recorder:** the recorder is
  per-registration and does not know which LevelFlight leg ended; arrival times
  may not be posted yet. More coupling, more edge cases.
- **Rejected — on-demand at first page view:** unviewed flights would never be
  snapshotted and would be lost once raw prunes at 14 days — defeats "forever."

## Data model

New migration `backend/migrations/007_flight_tracks.sql`:

```sql
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

Permanent — never pruned. System of record for historical flight paths. Soft-fails
if Supabase is absent, matching existing migrations. (Table already created in
Supabase by the user; the migration file documents and reproduces it.)

## Components

### Backend

**`backend/src/services/flightTrackStore.js`** (new) — soft-failing Supabase
access, mirrors `adsbStore.js`:
- `getFlightTrack(legId)` → row or null.
- `hasFlightTrack(legId)` → boolean (cheap existence check for the reconciler).
- `upsertFlightTrack(row)` → upsert by `leg_id`; soft-fails (returns null) when
  Supabase is off or the write errors.

**`backend/src/services/flightTrackReconciler.js`** (new) — the periodic job:
- `runReconcile({ days })`: fetch completed legs from LevelFlight over the last
  `days` (reuse the `monthAnchors` + `lf.getScheduledLegs` + `eqTail` pattern
  from the previous-flights route), filter to legs with `arr <= now`, skip any
  already in `flight_tracks` (`hasFlightTrack`), then for each remaining leg query
  raw positions (`queryTrack`) and clip (`clipTrackToLeg`) and `upsertFlightTrack`.
  Idempotent. Returns a small summary (`{ scanned, written, skipped }`).
- `startReconciler()`: on boot, run the backfill once (`runReconcile({ days: 90 })`),
  then run a short-lookback pass (`runReconcile({ days: RECONCILE_LOOKBACK_DAYS })`,
  default 3) on an hourly interval. Started from `index.js` alongside
  `startRecorder()`. The hourly pass uses a small window because it only needs to
  catch flights that completed since the last run; the 90-day sweep is the
  one-time backfill. Both are idempotent (skip already-stored legs), so the boot
  backfill is safe on every restart.

**`backend/src/routes/adsb.js`** — add `GET /flight-track/:legId`:
1. Snapshot hit → `{ legId, track, from, to, depTime, arrTime, source: 'snapshot' }`.
2. No snapshot but `tail`/`dep` query params present (in-progress / not yet
   reconciled) → live fallback: `queryTrack` + `clipTrackToLeg` for
   `[dep − PREV_PAD_MS, (arr || now) + PREV_PAD_MS]`, return
   `{ ..., source: 'live' }`. Not stored.
3. Nothing → `{ legId, track: [], source: 'none' }`.

**`backend/src/services/adsbRecorder.js`** — change `RETENTION_DAYS` 90 → 14.
**Only after the backfill has run.** (See Rollout.)

### Frontend

**`frontend/src/components/FlightTrackMap.jsx`** (new) — self-contained Leaflet
map. Props: `track` (`[[lat,lon], ...]`), `from`, `to`, optional `source`.
Behavior: create a Leaflet map (CARTO dark tiles, matching `Map.jsx`), draw the
track polyline, departure + arrival markers, `fitBounds` to the track. When
`track` is empty, render a tidy empty state ("No flight path recorded for this
flight"). Cleans up the map instance on unmount. Does not import from `Map.jsx`.

**`frontend/src/hooks/useAdsb.js`** — add
`fetchFlightTrack(legId, { tail, dep, arr } = {})`, mirroring
`fetchPreviousFlights`: builds the query string, returns the parsed JSON or
`{ track: [], source: 'none' }` on failure.

**`frontend/src/pages/FlightDetail.jsx`** — on mount, read
`leg._id?.$oid` (+ `leg.dispatch?.aircraft?.tailNumber`, `leg.departure?.time`,
`leg.arrival?.time` for the live fallback), call `fetchFlightTrack`, and render
`<FlightTrackMap>` full-width below the header, above the two-column grid.

## Data flow

Flight completes → within ~1h the reconciler clips its track and upserts a
permanent `flight_tracks` row. User opens the flight page → `FlightDetail` calls
`GET /flight-track/:legId` → snapshot returned and drawn by `FlightTrackMap`. For
an in-progress flight, no snapshot exists yet, so the endpoint clips raw positions
live (using the tail/times the page passes) and returns `source: 'live'`.

## Edge cases

- **Supabase off / persistence disabled:** store and reconciler soft-fail; the
  endpoint returns an empty track; the page renders the empty state. Page
  otherwise works.
- **Direct link / refresh of an in-progress flight:** `FlightDetail` gets its leg
  from router state, so on a cold load there is no `leg` (no tail/times). The
  snapshot still loads by `legId`; the live fallback simply won't draw. Acceptable
  — in-progress flights are recent and rarely deep-linked. (Pre-existing
  limitation of `FlightDetail`, not introduced here.)
- **Flight with no ADS-B coverage:** empty track → empty state.
- **Leg times edited in LevelFlight after snapshot:** snapshot is keyed by
  `leg_id` and written once; it is not rewritten. Acceptable for v1.
- **Re-running the reconciler/backfill:** idempotent via `hasFlightTrack` skip.

## Rollout / sequencing

1. Ship backend + frontend code (retention still 90 days).
2. Run the one-time backfill: `runReconcile({ days: 90 })` (happens automatically
   on first boot; safe to re-run).
3. Verify `flight_tracks` is populated for recent flights.
4. **Then** reduce `adsbRecorder.js` `RETENTION_DAYS` 90 → 14 and redeploy.

Reducing retention before the backfill would discard raw history we haven't yet
snapshotted — do not reorder.

## Testing

The backend has a minimal `node:test` setup (used for pure helpers). We will not
add a framework. Instead:

- `node:test` units for `flightTrackReconciler`'s pure decision logic — "skip a
  leg already in `flight_tracks`", "only consider legs with `arr <= now`" — using
  injected/stubbed store + leg lists (keep side-effecting calls thin and
  injectable so they can be exercised without Supabase/LevelFlight).
- `node:test` smoke for `flightTrackStore` soft-fail path (returns null/empty with
  no Supabase env) and the `/flight-track/:legId` route's branch selection
  (snapshot vs live vs none) where feasible without external services.
- Manual verification in the running app: open a recently-completed flight's page
  and confirm its path renders; open an in-progress flight and confirm the live
  track draws; open a flight with no coverage and confirm the empty state.

## Files touched

- `backend/migrations/007_flight_tracks.sql` (new)
- `backend/src/services/flightTrackStore.js` (new)
- `backend/src/services/flightTrackReconciler.js` (new)
- `backend/src/routes/adsb.js` (modify — add `GET /flight-track/:legId`)
- `backend/src/index.js` (modify — `startReconciler()`)
- `backend/src/services/adsbRecorder.js` (modify — retention 90 → 14, post-backfill)
- `frontend/src/components/FlightTrackMap.jsx` (new)
- `frontend/src/hooks/useAdsb.js` (modify — `fetchFlightTrack`)
- `frontend/src/pages/FlightDetail.jsx` (modify — render the map)
