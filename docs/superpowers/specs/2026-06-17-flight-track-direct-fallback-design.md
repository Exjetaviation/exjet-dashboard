# Flight Track — direct airport→airport fallback

**Date:** 2026-06-17
**Status:** Approved (design)

## Problem

The per-flight track map (`FlightTrackMap` on the flight detail page) draws a
flight's real ADS-B path from a permanent snapshot, or a live clip for
in-progress flights. But the ADS-B recorder only started recently, so **historical
flights have no stored track** and show the "No flight path recorded" empty state.

We want a fallback so those flights still show *something* meaningful: an
origin→destination line.

## Investigation result (why not ForeFlight)

We checked whether ForeFlight could supply a planned route to draw. It cannot, as
currently integrated: `dispatch.foreflight.com/public/api/Flights/{id}/navlog`
(and briefing/wb/etc.) return only a **signed PDF URL + timestamp**, not
coordinates. The flight record carries a route *string* (e.g. `"DCT"`) but no
waypoint lat/lons, and there is no GPS-track endpoint. Extracting a drawable route
would require parsing the navlog PDF — fragile, high-effort, and still only
planned. Rejected.

**Key enabling fact:** every LevelFlight leg already carries its airport
coordinates — `leg._calc.from.location.{lat,lng}` (departure) and
`leg._calc.to.location.{lat,lng}` (arrival). The fleet map (`Map.jsx`) already
uses these. So a direct departure→arrival line needs **no new data source**.

## Goal

For a flight with no real (snapshot/live) ADS-B track, draw a **direct
great-circle-straight line from departure airport to arrival airport**, rendered
distinctly (dashed) and labeled "direct route" so it is never mistaken for the
actual flown path. Flights that DO have a real track are unaffected.

Non-goals: airway/waypoint routing, great-circle curvature (web-mercator straight
line is fine for mostly-domestic legs), parsing ForeFlight documents, any backend
change.

## Approach (chosen: frontend-only)

The flight detail page already has the leg object (with airport coords) in router
state, and already calls `fetchFlightTrack`. So the fallback is computed entirely
in the frontend when the track endpoint yields nothing. No backend route, no
migration, no new endpoint.

Rejected alternative — backend branch on `/flight-track/:legId`: the endpoint
would have to re-fetch the leg from LevelFlight solely to read airport coords the
frontend already holds. More work, no benefit.

## Fallback chain

`FlightTrackMap` renders by `source`, in priority order:

1. `snapshot` — permanent stored ADS-B track (solid blue). *(existing)*
2. `live` — live-clipped ADS-B track for in-progress flights (solid blue + "live" badge). *(existing)*
3. `direct` — straight departure→arrival line (dashed grey + "direct route" badge). *(new)*
4. `none` — empty state "No flight path recorded". *(existing; now only when even a direct line is impossible)*

## Components

### `frontend/src/pages/FlightDetail.jsx` (modify)

In the existing track-fetch effect, after `fetchFlightTrack(legId, {...})` resolves:

- If `res.track?.length` → `setFlightTrack(res)` (real snapshot/live track — unchanged).
- Else derive a direct line:
  - `const a = leg?._calc?.from?.location; const b = leg?._calc?.to?.location;`
  - If `a?.lat != null && a?.lng != null && b?.lat != null && b?.lng != null` →
    `setFlightTrack({ track: [[a.lat, a.lng], [b.lat, b.lng]], source: 'direct', from: leg.departure?.airport, to: leg.arrival?.airport })`.
  - Else → `setFlightTrack(res)` (the `none` result; truly nothing to draw).

The `<FlightTrackMap>` render call already passes `track`/`from`/`to`/`source`;
no prop change needed — `source` now may be `'direct'`.

### `frontend/src/components/FlightTrackMap.jsx` (modify)

The track-draw effect currently always draws a solid blue polyline. Branch on
`source`:

- `source === 'direct'` → polyline style `{ color: '#94a3b8', weight: 2, opacity: 0.7, dashArray: '6 6' }` (dashed grey, matching the fleet map's dashed destination-line aesthetic).
- otherwise → existing solid blue `{ color: '#38bdf8', weight: 3, opacity: 0.85 }`.

Departure (green) / arrival (red) circle markers + tooltips stay for all sources.

Badge (top-right overlay), driven by `source`:
- `source === 'live'` && track non-empty → "live" badge (existing).
- `source === 'direct'` && track non-empty → "direct route" badge (same overlay style, distinct text; reuse the badge styling).

Empty-state overlay ("No flight path recorded") shows only when `track.length === 0`
(unchanged — a `direct` track always has 2 points, so it never triggers the empty state).

`source` must be added to the draw effect's dependency array (it currently lists
`[track, from, to]`) since the polyline style now depends on it.

## Data flow

Open a historical flight → `fetchFlightTrack` returns `{track: [], source: 'none'}`
(no snapshot, and live clip empty/absent) → `FlightDetail` sees empty track, reads
`leg._calc.from/to.location`, builds the 2-point line, sets `source: 'direct'` →
`FlightTrackMap` draws a dashed grey line + "direct route" badge. A flight WITH a
real track skips the fallback entirely.

## Edge cases

- **Missing airport coords** (`_calc.from/to.location` absent) → no direct line;
  the `none` empty state shows. (Rare; legs generally have `_calc`.)
- **Real track present** → fallback never runs; unchanged behavior.
- **In-progress flight** → live clip wins; if the live clip is somehow empty, the
  direct line shows as a reasonable placeholder until the snapshot lands.
- **Same dep/arr airport** (round-robin/positioning with identical endpoints) →
  degenerate 2-identical-point line; Leaflet handles gracefully (the existing
  single-point `fitBounds` behavior applies).

## Testing

No backend changes and no new pure logic worth a framework. The direct-line derive
is a trivial inline guard. Verify via:
- `npx eslint` on the two changed files — clean.
- `npm run build` — succeeds.
- Manual: open a historical flight (no ADS-B) → dashed "direct route" line + badge;
  open a flight with a real track → solid blue, no "direct" badge; open a flight
  with no `_calc` coords → empty state.

## Files touched

- `frontend/src/pages/FlightDetail.jsx` (modify — derive direct line on empty track)
- `frontend/src/components/FlightTrackMap.jsx` (modify — dashed style + "direct route" badge for `source: 'direct'`)
