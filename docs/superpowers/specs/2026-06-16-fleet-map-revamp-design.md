# Fleet Map revamp — live flights, always-on track recording, previous flights

**Date:** 2026-06-16
**Status:** Approved (design)

## Goal

Revamp the fleet map (`frontend/src/pages/Map.jsx`) to:
1. Show live flights from real ADS-B position (not schedule interpolation).
2. Show a live "time flying" timer per airborne aircraft (since actual takeoff).
3. Show a destination-airport icon for in-flight aircraft, with a line from the
   aircraft to it.
4. Let the user click an aircraft to toggle that aircraft's **previous flights**
   and their real flown paths over a rolling few days.

Hard requirement: flight paths must be recorded **on the server, always** —
independent of whether anyone has the map open. Today the trail only grows while
a client is polling `/api/adsb/positions`; that must change.

## Data reality (what we have)

- `GET /api/adsb/positions` → `{ reg: { lat, lon, altitudeFt, onGround,
  groundSpeedKt, track, secondsSincePosition, ... } }` (live, per registration).
- `getTrails()` keeps an **in-memory** rolling `history[reg] = [{lat,lon,t}]`,
  appended only inside `getLivePositions()` — so it only records while a client
  polls, and resets on restart. This is what we replace with persistence.
- `GET /api/levelflight/legs` → completed/scheduled legs with departure/arrival
  airports (`_calc.from/to.location` lat/lng) and `departure.time`/
  `arrival.time`. No route geometry. Used here for **flight identity** of
  previous flights.
- ADS-B `onGround` (`alt_baro === 'ground'`) lets us detect takeoff/landing.

## Architecture

### Backend

**1. Always-on recorder (`backend/src/services/adsbRecorder.js`, new)**
- Starts with the server (invoked from `src/index.js` after `app.listen`).
- Every `RECORD_INTERVAL_MS` (default 15s): calls the existing
  `getLivePositions()` and, for each aircraft that has moved more than the
  existing `TRAIL_MIN_MOVE_DEG` threshold, **persists a row** to Supabase
  `adsb_positions`.
- Runs regardless of client connections. Single interval; guarded so it never
  overlaps a slow poll. Errors are logged and swallowed (never crash the server).
- On each tick, maintains in-memory `airborneSince[reg]`: set to `now` on an
  onGround→airborne transition, cleared on airborne→onGround. Seeded on startup
  from the most recent persisted positions so a restart doesn't lose an active
  flight's takeoff time (best-effort; falls back to first-airborne-seen).

**2. Persistence + retention (`adsb_positions` table, migration 006)**
```sql
create table if not exists public.adsb_positions (
    id          bigint generated always as identity primary key,
    registration text not null,
    lat         double precision not null,
    lon         double precision not null,
    altitude_ft integer,
    on_ground   boolean not null default false,
    t           timestamptz not null
);
create index if not exists adsb_positions_reg_t_idx on public.adsb_positions (registration, t);
```
- Retention: the recorder prunes rows older than `RETENTION_DAYS` (default 7) on
  a low-frequency timer (e.g. hourly).
- Soft-fail: if Supabase isn't configured, the recorder logs once and no-ops
  (live positions still work; previous-flights returns empty). Same philosophy
  as `reviewStore.js`.

**3. Endpoints (`backend/src/routes/adsb.js`)**
- `GET /api/adsb/positions` — unchanged shape, **plus** `airborneSinceMs` per
  aircraft (epoch ms or null).
- `GET /api/adsb/previous-flights?tail=<reg>&days=<n>` (new):
  - Fetches legs server-side via the existing LevelFlight service
    (`lf.getScheduledLegs`, same month-walk the `/legs` route uses), filters to
    `tail` and completed legs whose `arrival.time` is within the last `n` days.
  - For each leg, queries `adsb_positions` for `registration = tail` and
    `t` within `[departure.time − PAD, arrival.time + PAD]`, ordered by `t`.
  - Returns `[{ legId, from, to, depTime, arrTime, track: [[lat,lon],...] }]`.
  - Legs with no persisted track (older than retention, or never recorded)
    return an empty `track` and are flagged so the UI can omit or show a hint.

### Frontend (`Map.jsx`)

`useAdsb` already exposes `positions`; extend the page to also use
`airborneSinceMs`. The schedule-interpolation (`getAircraftPositions`) is
demoted: live ADS-B position is primary; schedule supplies the active leg
(for destination + label) and is the fallback only when ADS-B has no fix.

- **Live markers**: real lat/lon, icon rotated to `track` heading; in-flight vs
  on-ground styling from `onGround`.
- **Flying timer**: a small component ticking every second showing
  `now − airborneSinceMs` as `H:MM` (or `MM:SS` under an hour), shown on the
  marker label/popup for airborne aircraft only.
- **Destination icon**: for an in-flight aircraft, resolve its active leg's
  arrival airport (`_calc.to.location`), drop an airport marker there, and draw
  a faint straight `Polyline` from aircraft → destination.
- **Previous flights (per aircraft)**: clicking an aircraft selects it and
  fetches `/api/adsb/previous-flights?tail=&days=`. Draw each returned `track`
  as a dimmed `Polyline` (color-keyed to the aircraft), with a day-window
  selector (default 3). Clicking the aircraft again, or a "clear" control,
  deselects and removes the paths. Only one aircraft's history shown at a time.

## Data flow

Server boot → recorder interval starts → every 15s persist moved positions +
update `airborneSince` → hourly prune.
Map open → `useAdsb` polls positions (+ `airborneSinceMs`) → render live markers,
timers, destination icons. Click aircraft → GET previous-flights → render dimmed
historical tracks for that tail.

## Components & isolation

- `adsbRecorder.js` — owns the interval, persistence, pruning, and
  `airborneSince` map. Pure helpers extracted for tests:
  `detectTakeoff(prevOnGround, nextOnGround, now, prevAirborneSince)` and
  `hasMoved(a, b, thresholdDeg)`.
- `previous-flights` handler — pure `clipTrackToLeg(positions, leg, padMs)`
  helper, unit-tested.
- Frontend `FlyingTimer` — pure `formatElapsed(ms)`, unit-testable; the ticking
  is a thin `useEffect` wrapper.

## Error handling

- Recorder: never throws to the event loop; per-tick try/catch, logs and
  continues. Supabase missing → single warning, no-op.
- previous-flights: Supabase missing or query error → `{ flights: [] }` (soft).
- Frontend: if previous-flights fails, show a toast/inline note, keep live map
  working. Missing `airborneSinceMs` → hide the timer (don't guess).

## Testing

- Unit (`node:test`): `detectTakeoff`, `hasMoved`, `clipTrackToLeg`,
  `formatElapsed`.
- Integration (manual, live ADS-B + Supabase): confirm the recorder writes rows
  while no client is connected; confirm `previous-flights` returns a real track
  for a recently-flown leg; confirm the timer counts from takeoff.

## Defaults / constants

- `RECORD_INTERVAL_MS = 15000`, `RETENTION_DAYS = 7`, previous-flights default
  `days = 3`, leg time pad `PAD = 10 min`. All single-sourced as constants.

## Out of scope

- Real route/waypoint geometry (we use real ADS-B track or nothing).
- Full date-range history UI (rolling few-days only).
- Backfilling tracks for flights that predate the recorder.

## Files

- `backend/migrations/006_adsb_positions.sql` (new)
- `backend/src/services/adsbRecorder.js` (new) + `adsbRecorder.test.js`
- `backend/src/services/adsb.js` (expose `airborneSince`; persistence hooks)
- `backend/src/routes/adsb.js` (add `previous-flights`; `airborneSinceMs` on
  positions)
- `backend/src/index.js` (start the recorder)
- `frontend/src/pages/Map.jsx` (revamp) + a small `FlyingTimer` + `formatElapsed`
- `frontend/src/hooks/useAdsb.js` (surface `airborneSinceMs`; per-aircraft
  previous-flights fetch helper)
