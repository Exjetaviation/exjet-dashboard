# Flight Map — animated plane, teardrop pins, rich tooltips

**Date:** 2026-06-17
**Status:** Approved (design)

## Problem

The flight detail map (`FlightTrackMap`) draws a track (solid blue real ADS-B, or
dashed grey direct fallback) with plain circle markers at departure/arrival whose
tooltips show only the airport code. We want three presentational upgrades:

1. An animated plane icon that loops along the track line, facing its direction of travel.
2. Teardrop "map pin" markers instead of circles (keeping green departure / red arrival).
3. Richer hover tooltips on those pins — airport code + name + date/time.

## Goal

Purely visual polish on the flight detail page map, using data the page already
holds. No backend, endpoint, or data-model changes. The fleet map (`Map.jsx`) is
out of scope and untouched.

## Design decisions (resolved during brainstorming)

- **Plane pacing:** fixed loop duration (~6s) for the full path regardless of
  distance; the plane repeats indefinitely and rotates to face the direction of
  travel.
- **Plane scope:** animates on ALL track types — real ADS-B (snapshot/live) AND
  the dashed direct-route fallback.
- **Tooltip content:** airport code + airport name + date/time (e.g.
  "KTEB · Teterboro — Departed Jun 14, 2:30 PM EST").

## Architecture

All rendering changes live in `frontend/src/components/FlightTrackMap.jsx`.
`frontend/src/pages/FlightDetail.jsx` only gains two computed string props it feeds
to the map (it already owns the leg data and a `formatDateTime` helper). Component
boundary stays clean: `FlightDetail` owns data/formatting; `FlightTrackMap` owns
Leaflet rendering.

## Components

### `frontend/src/pages/FlightDetail.jsx` (modify)

Build two tooltip label strings from the leg and pass them to `<FlightTrackMap>`:

- `depLabel` = `<strong>{leg.departure?.airport}</strong>` + (` · {leg._calc?.from?.name}` if present) + `<br>Departed {formatDateTime(leg.departure?.time)}` (omit the "Departed …" line if no time).
- `arrLabel` = same shape with `leg.arrival?.airport`, `leg._calc?.to?.name`, `Arrived {formatDateTime(leg.arrival?.time)}`.

These are small HTML strings (Leaflet tooltips render string content as HTML).
Pass as new props: `<FlightTrackMap ... depLabel={depLabel} arrLabel={arrLabel} />`.
`formatDateTime` already exists in this file. The existing `from`/`to`/`track`/
`source` props are unchanged.

### `frontend/src/components/FlightTrackMap.jsx` (modify)

New props: `depLabel`, `arrLabel` (optional HTML strings).

**(a) Teardrop pins** — replace the two `L.circleMarker(...)` calls with
`L.marker(latlng, { icon: pinIcon(color) })` where `pinIcon(color)` returns an
`L.divIcon` containing an SVG teardrop/map-pin path filled with `color`, sized
~24×24, with `iconAnchor` at the tip (bottom-center, e.g. `[12, 24]`) and
`tooltipAnchor` near the top so the tooltip clears the pin. Departure pin color
`#22c55e` (green), arrival `#ef4444` (red). Tooltip content: `depLabel`/`arrLabel`
when provided, else fall back to the existing `from || 'Departure'` /
`to || 'Arrival'`. Keep the `exjet-tooltip` tooltip class.

`pinIcon(color)` is a small module-level pure helper (defined once, not per
render) returning a divIcon — keeps the marker code declarative.

**(b) Animated plane** — a SEPARATE `useEffect` keyed on `[track]` (independent of
the polyline/pin draw effect):
- If `track.length < 2`, do nothing (no plane).
- Create one `L.marker` using a `planeIcon()` divIcon: an SVG top-down plane whose
  inner element carries a CSS `transform: rotate(<deg>)`. Add it to the map (its
  own marker, not part of the cleared `_trackLayer` group).
- Precompute segment data from `track`: per-segment `[from, to]` plus cumulative
  fractional lengths over total path length (planar lat/lng distance is fine for a
  visual). 
- `requestAnimationFrame` loop: `t = ((now - start) % DURATION) / DURATION` with
  `DURATION = 6000`. Map `t` (0→1) to a position along the cumulative path; set the
  marker's latlng; compute the current segment bearing (`atan2` of lat/lng delta,
  converted to degrees, oriented so the plane nose follows travel) and apply it as
  the inner element's rotation.
- Cleanup (effect return): `cancelAnimationFrame(rafId)` and remove the plane
  marker. This runs on unmount AND whenever `track` changes, so no duplicate planes
  or leaked loops.
- Uses `performance.now()` for timing (allowed in app code).

Both the pin colors and the plane behavior are identical across `source` values
(real and direct). The polyline styling by `source` (solid blue vs dashed grey)
from the prior change is retained.

## Data flow

`FlightDetail` resolves the track (snapshot / live / direct / none) as today,
computes `depLabel`/`arrLabel` from the leg, and renders `<FlightTrackMap>`.
`FlightTrackMap` draws the polyline + two teardrop pins (with rich tooltips), and a
separate effect animates a rotating plane marker looping the path every 6s.

## Edge cases

- **track.length < 2** (single point or empty) → no plane; pins still render if a
  point exists; empty state unchanged for empty track.
- **Missing airport name/time** → label degrades gracefully (code only, or no
  time line); tooltip falls back to `from`/`to` if a label prop is absent.
- **Track changes** (e.g. async snapshot arrives after a direct line) → plane
  effect tears down and re-inits cleanly via the `[track]` dependency.
- **Unmount mid-animation** → rAF cancelled, marker removed.
- **Degenerate/zero-length segments** in the cumulative-length math → guard so a
  zero total length doesn't divide-by-zero (skip the plane if total length is 0).

## Testing

No backend changes; geometry is simple and the rest is visual. Verify via:
- `npx eslint` on the two changed files — clean.
- `npm run build` — succeeds.
- Manual: pins render as teardrops (green dep / red arr) with tips on the
  coordinates; hovering shows code + name + date/time; a plane loops the line every
  ~6s and rotates to face travel — confirmed on BOTH a real ADS-B track and a
  dashed direct line; no duplicate planes after the track updates.

## Files touched

- `frontend/src/components/FlightTrackMap.jsx` (modify — teardrop pins, rich tooltips, animated plane)
- `frontend/src/pages/FlightDetail.jsx` (modify — compute and pass `depLabel`/`arrLabel`)
