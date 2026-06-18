# Flights → Trips & Legs tabs + dashboard Trip page — design

**Date:** 2026-06-18
**Status:** Approved (design)

## Problem

The Flights page is a flat list of individual legs. Ops also think in **trips** (a
dispatch = all legs of one charter). They want to browse by trip — legs grouped under
their trip with quick actions — while keeping today's flat legs view, and a dashboard
**trip page** showing all a trip's legs with the flight path (the itinerary map, but
in-dashboard).

## Goal

Split the Flights page into **Legs** (today's table, unchanged) and **Trips** (legs
grouped by dispatch, collapsible, with Itinerary + Trip Sheet actions), and add a
dashboard **Trip detail page** (`/trips/:id`) with the full multi-leg flight-path map,
the legs list, and the same actions.

## Decisions (resolved during brainstorming)
- **Navigation:** one "Flights" sidebar item; in-page **Legs | Trips** tabs synced to
  `?view=` (Legs is the default). Shared data fetch + filter bar.
- **Trip actions:** **Itinerary** opens the public `/itinerary/<dispatchId>` page in a
  new tab; **Trip Sheet** opens the authed rendered trip sheet in an in-app modal with
  Download PDF — reusing the exact component from the flight detail page.
- **Trip page:** a dashboard page at `/trips/:id` with all legs + flight-path map
  ("like the itinerary, but on the dashboard").

## Architecture

### 1. `pages/Flights.jsx` — container with tabs
Keeps the single fetch (`useApi('/api/levelflight/legs')`) and one `FlightsFilterBar`
producing `visible` legs. Adds a **Legs | Trips** tab control bound to
`useSearchParams()` (`?view=trips`, default `legs`). Renders `FlightsList` (Legs) or
`TripsList` (Trips) from the same `visible` array — so filters/search apply to both.

### 2. `lib/trips.js` — pure grouping (unit-tested)
`groupLegsIntoTrips(legs)` → array of trip objects, grouped by
`leg.dispatch._id.$oid` (legs without one fall into an `ungrouped` bucket keyed by a
sentinel, never dropped). Each trip:
`{ dispatchId, tripId, quoteId, tail, type, client, legs (sorted by departure.time),
from, to, routeSummary, start, end, legCount, status }`.
- `routeSummary` = ordered airport chain (`leg[0].departure` → each `arrival`).
- `start`/`end` = min departure / max arrival time.
- `status` = `Completed` if every leg status is completed (3), else the earliest
  non-completed leg's status (drives a status pill; per-leg status still shows in the
  legs table).
Trips returned sorted by `end` descending (newest first).

### 3. `components/TripsList.jsx`
Renders trip cards from `groupLegsIntoTrips(visible)`. Each card header: Trip # ·
`routeSummary` · date range · tail · client · "N legs" · status pill, a **chevron**
toggling an inline expand, and actions: **View trip ↗** (→ `/trips/:dispatchId`),
**Itinerary** (`<a href={API_BASE}/itinerary/<id>` target=_blank`), **Trip Sheet**
(`<TripSheetActions>`). Expanding renders that trip's legs via `FlightsList`
(`hideColumns` = aircraft, since one tail) — rows still route to `/flights/:id`.
Expanded state = a `Set` of dispatchIds in local state.

### 4. `components/TripSheetActions.jsx` (extracted from FlightDetail)
Encapsulates the trip-sheet **View** (`apiFetch('/api/tripsheet/:id')` → modal iframe)
+ **Download PDF** (`apiFetch('/api/tripsheet/:id/pdf')` → blob) logic and the modal.
Props: `{ dispatchId, tripId, variant }` (variant tunes button sizing/labels).
`FlightDetail` is refactored to use it (removing its inline trip-sheet block); the
itinerary buttons stay in `FlightDetail`. Reused by `TripsList` and `TripDetail`.

### 5. `components/TripPathMap.jsx` (new)
The dashboard/Leaflet equivalent of the itinerary map. Props: `{ legs }`. For each leg
with `_calc.from.location` + `_calc.to.location`, draws a polyline + a teardrop pin at
each airport (deduped by code), fits bounds, and animates a looping plane along the
concatenated path (reusing `FlightTrackMap`'s segment/rAF/rotation approach). Dark
CARTO tiles, matching `FlightTrackMap`. Shows "Route map unavailable" when no leg has
coords.

### 6. `pages/TripDetail.jsx` (new) + route
Route `/trips/:id` (added in `App.jsx`). Receives the trip via router `state.trip`
(passed by `TripsList`); on a cold load / refresh with no state, fetches
`/api/levelflight/legs`, runs `groupLegsIntoTrips`, and picks the trip whose
`dispatchId === :id`. Renders: a back button, header (Trip # · route · date range ·
aircraft · client · status), the action row (Itinerary link + `TripSheetActions`),
`<TripPathMap legs={trip.legs} />`, and the legs list via `FlightsList`
(`hideColumns` = aircraft), rows → `/flights/:id`.

## Data flow
`/api/levelflight/legs` → `Flights` filters → `visible`. Trips tab groups `visible`
into trips. Clicking **View trip** → `/trips/:id` with the trip in router state →
`TripDetail` renders the map + legs + actions. Itinerary/Trip Sheet reuse the existing
backend routes (no backend changes).

## Edge cases
- **No `?view`** → defaults to Legs (today's behavior).
- **Leg without `dispatch._id`** → grouped under "Ungrouped"; not lost.
- **TripDetail deep-link/refresh (no router state)** → re-fetch + regroup by `:id`;
  if still not found, show "Trip not found" with a back button.
- **Trip with no leg coords** → `TripPathMap` shows its unavailable message; the rest
  of the page renders.
- **Filters/search** apply identically to both tabs (same `visible` source).

## Testing
- `lib/trips.js` `groupLegsIntoTrips` unit-tested via `node --test` (pure JS): grouping
  by dispatch, leg ordering, route summary, date range, status derivation, ungrouped
  bucket.
- `npm run build` clean.
- Manual: Legs|Trips toggle + URL sync; filter applies to both; trip cards expand;
  inline leg rows and `/trips/:id` both reach `/flights/:id`; Itinerary opens the
  public page; Trip Sheet opens the modal + PDF; TripDetail map animates across all
  legs.

## Files touched
- `frontend/src/pages/Flights.jsx` (modify — tabs + shared fetch/filter)
- `frontend/src/lib/trips.js` (new — `groupLegsIntoTrips`) + `trips.test.js`
- `frontend/src/components/TripsList.jsx` (new — grouped collapsible cards + actions)
- `frontend/src/components/TripSheetActions.jsx` (new — extracted view/PDF modal)
- `frontend/src/components/TripPathMap.jsx` (new — multi-leg animated map)
- `frontend/src/pages/TripDetail.jsx` (new — dashboard trip page)
- `frontend/src/pages/FlightDetail.jsx` (modify — use `TripSheetActions`)
- `frontend/src/App.jsx` (modify — add `/trips/:id` route)
